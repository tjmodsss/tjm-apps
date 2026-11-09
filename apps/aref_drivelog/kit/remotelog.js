'use strict';
/**
 * remotelog.js - encrypted crash logs (Node 8, no npm modules).
 *
 * The app's own rolling log (mgu.js: <data>/<id>.log and .1) stays on the unit. A bundle is made only
 * after a crash (the last session did not end cleanly) or when asked ("Send logs now"): the last
 * session's log lines, uptime and boot ids, any readable reboot reason and journal lines. It is
 * scrubbed of personal details, gzipped, sealed to the public key below (X25519 + HKDF-SHA256 +
 * AES-256-GCM; only the matching private key opens it) and kept in a small outbox until uploaded.
 *
 * Upload: only with a drop installed on the unit - <data>/remotelog.json { "repo": "owner/name",
 * "token": "..." }, owned by the app's uid and readable by it only - as one file per bundle through
 * GitHub's contents API to that (private) repository. Retried with backoff; never on the UI's path.
 * The key bundles are sealed to is fixed here, not read from the drop file.
 *
 * Coordination between apps (each has its own uid and data): a small folder in /tmp where G's Dash
 * leaves "send now" requests and the on/off switch, and each app its last-sent status.
 *
 * The ring (ringlog.js, G's Dash 0.13.4): the HUD / cluster renderer / look / memory lines of this run and the
 * one before, kept on the app's data area so a head unit restart still leaves them; written only while a drop
 * is installed and the switch is on, added to every bundle (scrubbed and sealed as the rest).
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const url = require('url');
const childProcess = require('child_process');
const x25519 = require('./x25519.js');
const ringlog = require('./ringlog.js');
const uplink = require('./uplink.js');

const MAGIC = Buffer.from('NGRL1');
const INFO = Buffer.from('ng-remotelog v1');

const LIMITS = {
    lines: 3000,                 // last session lines in a bundle
    logBytes: 384 * 1024,        // of log text in a bundle (before gzip)
    extraBytes: 96 * 1024,       // per journal / reboot-reason / helper section
    sealed: 384 * 1024,          // one sealed bundle at most
    outboxFiles: 6,              // the outbox keeps at most this many bundles
    outboxBytes: 2 * 1024 * 1024,    // and this many bytes; the oldest go first
    crashPerDay: 6,              // crash bundles a day (a crash loop sends a few, not hundreds)
    manualGapMs: 60 * 1000,      // "send now" at most once a minute
    maxAgeMs: 14 * 24 * 3600 * 1000,
};
const BACKOFF = [30e3, 120e3, 600e3, 1800e3, 3600e3];
const BEAT_MS = 60e3;
const REBOOT_GAP_MS = 2 * BEAT_MS;
const SHARED = '/tmp/ng-remotelog';
const HELPER_OUT = ['/var/opt/ng-remotelog/out', '/run/ng-remotelog'];

/* ---------------- scrubbing ---------------- */
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const RULES = [
    // secrets first (they may contain anything below)
    [/-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g, '[key]'],
    [/\b(Bearer|Basic|token)\s+[A-Za-z0-9._~+\/=-]{8,}/gi, '$1 [secret]'],
    [/\b(github_pat_|gh[pousr]_)[A-Za-z0-9_]{10,}/g, '[secret]'],
    [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(\.[A-Za-z0-9_-]*)?/g, '[jwt]'],
    // "key": "value" / key=value with a sensitive key
    [/("?(?:[\w-]*(?:token|secret|passw(?:or)?d|auth\w*|cookie|session\w*|api_?key|private_?key|client_?id|code|verifier|ssid|psk|serial|imei|vin|user(?:name)?|account|email|phone\w*|device_?name|owner))"?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;&}\]]+)/gi, '$1[redacted]'],
    // location
    [/("?(?:lat(?:itude)?|lon(?:gitude)?|lng|gps\w*|position|heading|altitude|location|coords?)"?\s*[:=]\s*)("[^"]*"|\[[^\]]*\]|[^\s,;&}]+)/gi, '$1[loc]'],
    [/[-+]?\d{1,2}\.\d{3,}\s*,\s*[-+]?\d{1,3}\.\d{3,}/g, '[loc]'],
    // e-mail, URLs' query strings and credentials
    [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]'],
    [/\b([a-z][a-z0-9+.-]*:\/\/)[^\/\s:@]+(?::[^\/\s@]*)?@/gi, '$1[user]@'],
    [/(\b[a-z][a-z0-9+.-]*:\/\/[^\s?#"']*)[?#][^\s"']*/gi, '$1?[query]'],
    // network ids
    [/\b(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}\b/gi, '[mac]'],
    [/\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g, '[ip]'],
    [/(^|[^\w:.])((?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4})(?![\w:])/gi, (m, a, v) => ((/::/.test(v) || (v.match(/:/g) || []).length >= 5) && v.length >= 6 && /[0-9a-f]{2}/i.test(v) ? a + '[ip6]' : m)],
    // a VIN (17 characters, no I O Q, letters and digits both)
    [/\b(?=[A-HJ-NPR-Z0-9]{17}\b)(?=[A-HJ-NPR-Z0-9]*\d)(?=[A-HJ-NPR-Z0-9]*[A-HJ-NPR-Z])[A-HJ-NPR-Z0-9]{17}\b/g, '[vin]'],
    // home folders, phone names, long opaque strings
    [/\/(home|Users|root)\/[^\/\s"']+/g, '/$1/[user]'],
    [/\b[A-Z][\w-]{0,30}(?:'|\u2019)s\s+(?:iPhone|iPad|Galaxy|Pixel|phone|Phone|Android|Mac\w*)\b/g, '[phone]'],
    [/\b[A-Za-z0-9+_-]{40,}={0,2}/g, '[blob]'],
];
/** text without personal details; secrets: extra strings (the drop's token, its repo) taken out word for word */
function scrub(text, secrets) {
    let s = String(text);
    (secrets || []).filter((x) => x && String(x).length >= 4).forEach((x) => { s = s.replace(new RegExp(escapeRe(String(x)), 'g'), '[secret]'); });
    RULES.forEach((r) => { s = s.replace(r[0], r[1]); });
    return s;
}

/* ---------------- sealing ---------------- */
function hkdf(ikm, salt, info, n) {
    const prk = crypto.createHmac('sha256', salt).update(ikm).digest();
    let t = Buffer.alloc(0), out = Buffer.alloc(0);
    for (let i = 1; out.length < n; i++) { t = crypto.createHmac('sha256', prk).update(Buffer.concat([t, info, Buffer.from([i])])).digest(); out = Buffer.concat([out, t]); }
    return out.slice(0, n);
}
/** NGRL1 | ephemeral public key (32) | iv (12) | AES-256-GCM ciphertext | tag (16) */
function seal(plain, pubB64) {
    const pk = Buffer.from(typeof pubB64 === 'string' ? pubB64 : '', 'base64');
    if (pk.length !== 32) throw new Error('bad public key');
    const esk = crypto.randomBytes(32), epk = x25519.publicKey(esk);
    const shared = x25519.scalarMult(esk, pk);
    if (shared.every((b) => b === 0)) throw new Error('bad public key');
    const key = hkdf(shared, Buffer.concat([epk, pk]), INFO, 32);
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', key, iv);
    c.setAAD(MAGIC);
    const ct = Buffer.concat([c.update(plain), c.final()]);
    return Buffer.concat([MAGIC, epk, iv, ct, c.getAuthTag()]);
}
/** for tests and the box (sk: 32 raw bytes) */
function open(buf, sk) {
    if (!buf.slice(0, 5).equals(MAGIC)) throw new Error('not a remote log bundle');
    const epk = buf.slice(5, 37), iv = buf.slice(37, 49), tag = buf.slice(buf.length - 16), ct = buf.slice(49, buf.length - 16);
    const pk = x25519.publicKey(sk);
    const key = hkdf(x25519.scalarMult(sk, epk), Buffer.concat([epk, pk]), INFO, 32);
    const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
    d.setAAD(MAGIC); d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]);
}

/* ---------------- helpers ---------------- */
const readText = (f, max) => new Promise((res) => fs.open(f, 'r', (e, fd) => {
    if (e) return res(null);
    fs.fstat(fd, (e2, st) => {
        const size = e2 ? 0 : st.size, want = Math.min(max, size || max), buf = Buffer.alloc(want);
        fs.read(fd, buf, 0, want, size > want ? size - want : 0, (e3, n) => { fs.close(fd, () => {}); res(e3 ? null : buf.slice(0, n).toString('utf8')); });
    });
}));
const readSync = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch (e) { return null; } };
const writeSyncSafe = (f, s) => { try { const t = f + '.tmp'; fs.writeFileSync(t, s); fs.renameSync(t, f); return true; } catch (e) { return false; } };
const writeAsync = (f, s) => new Promise((res) => fs.writeFile(f + '.tmp', s, (e) => e ? res(false) : fs.rename(f + '.tmp', f, (e2) => res(!e2))));
const run = (cmd, args, ms) => new Promise((res) => {
    try {
        childProcess.execFile(cmd, args, { timeout: ms || 4000, maxBuffer: 512 * 1024, encoding: 'utf8' }, (e, out) => res(e && !out ? null : String(out || '')));
    } catch (e) { res(null); }
});
const tail = (s, n) => s.length > n ? s.slice(s.length - n) : s;

/* ---------------- the drop ---------------- */
function readDrop(dataDir) {
    const f = path.join(dataDir, 'remotelog.json');
    let st;
    try { st = fs.lstatSync(f); } catch (e) { return { state: 'none' }; }
    if (!st.isFile()) return { state: 'bad', why: 'not a file' };
    if (typeof process.getuid === 'function' && st.uid !== process.getuid()) return { state: 'bad', why: 'wrong owner' };
    if (st.mode & 0o077) return { state: 'bad', why: 'readable by others' };
    try {
        const j = JSON.parse(fs.readFileSync(f, 'utf8'));
        if (!/^[\w.-]+\/[\w.-]+$/.test(j.repo || '') || !/^[\w-]{20,255}$/.test(j.token || '')) return { state: 'bad', why: 'incomplete' };
        // the destination and its encryption key both come only from this privately installed file
        if (typeof j.pub !== 'string' || Buffer.from(j.pub, 'base64').length !== 32) return { state: 'bad', why: 'incomplete' };
        let api = 'https://api.github.com';
        if (j.api && process.env.NG_REMOTELOG_TEST_API) api = j.api;
        return { state: 'ok', repo: j.repo, token: j.token, pub: j.pub, api, dir: /^[\w.-]{1,40}$/.test(j.dir || '') ? j.dir : 'bundles' };
    } catch (e) { return { state: 'bad', why: 'unreadable' }; }
}

/* ---------------- network (as G's TV / G's Music: the mgu-uplink lease's DNS, a root-owned ca.pem) ---------------- */
function makeRequester(dataDir) {
    const agent = new https.Agent({ keepAlive: false, maxSockets: 1 });
    const lookupFor = uplink.resolver();
    return (method, href, headers, body) => new Promise((resolve, reject) => {
        const u = url.parse(href), tls = u.protocol === 'https:';
        if (!tls && !(u.protocol === 'http:' && process.env.NG_REMOTELOG_TEST_API)) { reject(new Error('https only')); return; }
        const opts = { method, host: u.hostname, port: u.port || (tls ? 443 : 80), path: u.path, headers: Object.assign({}, headers), timeout: 20000 };
        if (tls) opts.agent = agent;
        if (body != null) opts.headers['Content-Length'] = Buffer.byteLength(body);
        const lookup = lookupFor(uplink.lease(dataDir));
        if (lookup) opts.lookup = lookup;
        const c = tls && uplink.trustedCa(dataDir); if (c) opts.ca = c;
        const req = (tls ? https : http).request(opts, (res) => {
            const chunks = []; let n = 0;
            res.on('data', (d) => { n += d.length; if (n < 65536) chunks.push(d); });
            res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
            res.on('error', reject);
        });
        req.on('timeout', () => { req.abort(); reject(new Error('timed out')); });
        req.on('error', reject);
        if (body != null) req.write(body);
        req.end();
    });
}

/* ---------------- the recorder ---------------- */
/**
 * create({ id, version, dataDir, logFile, log(level, msg), [shared], [request], [now], [proc], [backoff], [startDelay] })
 * begin() at load (sync: the session marker), start() once running (timers), end(code) / fatal() from mgu.js.
 */
function create(o) {
    const now = o.now || Date.now;
    const dir = path.join(o.dataDir, 'remotelog'), outbox = path.join(dir, 'outbox');
    const sessionFile = path.join(dir, 'session.json'), stateFile = path.join(dir, 'state.json');
    const shared = o.shared || SHARED;
    const proc = o.proc || { bootId: '/proc/sys/kernel/random/boot_id', uptime: '/proc/uptime' };
    const backoff = o.backoff || BACKOFF;
    const note = (lvl, m) => { try { o.log && o.log(lvl, 'remote logs: ' + m); } catch (e) {} };
    const request = o.request || makeRequester(o.dataDir);
    let session = null, previous = null, crash = null, state = { lastSent: null, crashes: [], manualAt: 0 };
    let timers = [], uploading = false, failures = 0, retryTimer = null, blocked = false, lastReq = 0, busy = Promise.resolve();
    const contexts = [];
    // the crash-surviving ring: on only with a drop installed and the switch on; no drop: nothing kept
    const ring = ringlog.create(Object.assign({ dir: path.join(dir, 'ring'), id: o.id, version: o.version, now, boot: () => bootId(),
        gate: () => (readDrop(o.dataDir).state !== 'ok' ? 'none' : enabled() ? 'on' : 'off') }, o.ring || {}));
    // absolute paths in a bundle made app-relative (the data folder, the app's own folder)
    const appDir = path.resolve(__dirname, '..');
    const relative = (s) => {
        let r = String(s);
        [[o.dataDir, '<data>'], [appDir, '<app>']].filter((p) => p[0] && p[0].length > 1).sort((a, b) => b[0].length - a[0].length)
            .forEach((p) => { r = r.split(path.resolve(p[0])).join(p[1]); });
        return r;
    };

    const bootId = () => (readSync(proc.bootId) || '').trim().slice(0, 64);
    const uptime = () => { const u = parseFloat(readSync(proc.uptime) || ''); return isFinite(u) ? u : null; };
    const mk = (d) => { try { fs.mkdirSync(d); } catch (e) { /* there */ } };
    const saveState = () => writeAsync(stateFile, JSON.stringify(state));

    function begin() {
        mk(dir); mk(outbox);
        try { previous = JSON.parse(fs.readFileSync(sessionFile, 'utf8')); } catch (e) { previous = null; }
        try { state = Object.assign(state, JSON.parse(fs.readFileSync(stateFile, 'utf8'))); } catch (e) { /* first */ }
        crash = classify(previous);
        try { ring.begin(); } catch (e) { /* never in the way */ }
        session = { v: 1, started: now(), beat: now(), boot: bootId(), version: o.version, clean: false, fatal: false };
        writeSyncSafe(sessionFile, JSON.stringify(session));
        if (crash) note('warn', 'the last session ended uncleanly (' + crash.kind + ')');
        return crash;
    }
    /** null (clean, or no record), or { kind: 'app' | 'reboot', ... } */
    function classify(p) {
        if (!p || p.clean) return null;
        if (p.fatal) return { kind: 'app', why: 'fatal error' };
        const b = bootId();
        if (!b || !p.boot || b === p.boot) return { kind: 'app', why: 'ended without a clean exit' };
        const up = uptime();
        if (up === null || !p.beat) return null;
        const gap = (now() - up * 1000) - p.beat;
        // the unit came back soon after our last heartbeat: it restarted while we ran (a car switched off
        // stays off for a while, and the unit shuts down after the apps)
        return gap < REBOOT_GAP_MS ? { kind: 'reboot', why: 'the head unit restarted while the app ran', gapS: Math.round(gap / 1000) } : null;
    }
    function beat() { if (session) { session.beat = now(); writeAsync(sessionFile, JSON.stringify(session)); } }
    function end(code) { try { ring.flushSync(); } catch (e) {} if (!session) return; session.clean = !code; session.code = code; session.beat = now(); writeSyncSafe(sessionFile, JSON.stringify(session)); }
    function fatal() { try { ring.flushSync(); } catch (e) {} if (!session) return; session.fatal = true; session.beat = now(); writeSyncSafe(sessionFile, JSON.stringify(session)); }

    /* --- policy / shared folder --- */
    function sharedRead(name) { try { return JSON.parse(fs.readFileSync(path.join(shared, name), 'utf8')); } catch (e) { return null; } }
    function sharedWrite(name, obj) {
        try { fs.mkdirSync(shared, 0o1777); fs.chmodSync(shared, 0o1777); } catch (e) { /* there */ }
        return writeAsync(path.join(shared, name), JSON.stringify(obj)).then((ok) => { if (ok) { try { fs.chmodSync(path.join(shared, name), 0o644); } catch (e) {} } return ok; });
    }
    // the switch (G's Dash's Diagnostics card): kept in this app's state; the other apps follow G's Dash's
    // through the shared folder
    function enabled() {
        if (readDrop(o.dataDir).state !== 'ok') return false;
        if (typeof state.on === 'boolean') return state.on;
        const p = sharedRead('policy.json');
        return !(p && p.on === false);
    }
    function setEnabled(on) {
        state.on = !!on; saveState();
        sharedWrite('policy.json', { on: !!on, at: now() });
        note('info', on ? 'on' : 'off');
        try { ring.refresh(); } catch (e) {}
        if (on) { blocked = false; kick(0); }
    }
    /** G's Dash: its switch shared at start, so the others follow it */
    function share() { if (typeof state.on === 'boolean') sharedWrite('policy.json', { on: state.on, at: now() }); }

    /* --- bundles --- */
    async function sessionLines(since) {
        const a = (await readText(o.logFile + '.1', LIMITS.logBytes)) || '', b = (await readText(o.logFile, LIMITS.logBytes)) || '';
        let lines = (a + b).split('\n');
        if (since) {
            const iso = new Date(since - 5000).toISOString();
            const k = lines.findIndex((l) => /^\d{4}-/.test(l) && l.slice(0, 24) >= iso);
            if (k > 0) lines = lines.slice(Math.max(0, k - 20));
        }
        return tail(lines.slice(-LIMITS.lines).join('\n'), LIMITS.logBytes);
    }
    async function extras(kind) {
        const x = {};
        for (const f of ['/sys/fs/pstore', '/sys/class/watchdog/watchdog0/bootstatus', '/proc/sys/kernel/panic']) {
            try {
                if (fs.statSync(f).isDirectory()) {
                    const names = fs.readdirSync(f).slice(0, 4);
                    for (const n of names) { const t = await readText(path.join(f, n), LIMITS.extraBytes); if (t) x['reboot:' + n] = t; }
                } else { const t = await readText(f, 4096); if (t) x['reboot:' + path.basename(f)] = t.trim(); }
            } catch (e) { /* not here */ }
        }
        // the root-side collector installed at the one plug-in (ng-remotelog helper): the cluster renderer's journal
        // (take-over / unmapping lines), the HMI processes, kernel OOM lines and coredumps, for this boot and the
        // one before; world-readable text files the app may read, written only by root
        for (const d of HELPER_OUT) {
            let names = [];
            try { const st = fs.statSync(d); if (st.uid !== 0 || (st.mode & 0o022)) continue; names = fs.readdirSync(d).filter((n) => /^[\w.-]+\.txt$/.test(n)).sort().slice(0, 12); } catch (e) { continue; }
            for (const n of names) {
                if (kind === 'app' && /^prevboot/.test(n)) continue;
                const t = await readText(path.join(d, n), LIMITS.extraBytes);
                if (t) x['helper:' + n] = t;
            }
        }
        const j = kind === 'reboot' ? await run('journalctl', ['-b', '-1', '-n', '400', '--no-pager', '-o', 'short-monotonic', '-p', '4'])
            : await run('journalctl', ['-b', '0', '-n', '300', '--no-pager', '-o', 'short-monotonic', '-p', '4']);
        if (j) x.journal = tail(j, LIMITS.extraBytes);
        const r = await run('journalctl', [kind === 'reboot' ? '-b' : '-b', kind === 'reboot' ? '-1' : '0', '-n', '3000', '--no-pager', '-o', 'short-monotonic']);
        if (r) { const c = r.split('\n').filter((l) => /cluster|render|oap_|ng_/i.test(l)).slice(-300).join('\n'); if (c) x['journal:cluster-render'] = tail(c, LIMITS.extraBytes); }
        return x;
    }
    /** reason: { kind, why } -> a sealed bundle in the outbox (async; nothing on the caller's path) */
    function bundle(reason, since) {
        busy = busy.then(async () => {
            const drop = readDrop(o.dataDir);
            // no drop installed (every car but the owner's): nothing is collected, nothing sent
            if (drop.state !== 'ok') return null;
            const secrets = [drop.token, drop.repo];
            const doc = {
                v: 1, app: o.id, version: o.version, created: new Date(now()).toISOString(), reason,
                uptimeS: uptime(), boot: bootId().slice(0, 8), previous: previous ? { version: previous.version, started: previous.started, beat: previous.beat, boot: (previous.boot || '').slice(0, 8), code: previous.code, fatal: !!previous.fatal } : null,
                rssMB: Math.round(process.memoryUsage().rss / 1048576), node: process.version,
                sections: {},
            };
            contexts.forEach((c) => { try { doc.sections['status:' + c.name] = JSON.stringify(c.fn()); } catch (e) {} });
            doc.sections.log = await sessionLines(since);
            // the ring: the run before's (a crash bundle: the run that crashed) and this run's
            try {
                const rg = ring.read();
                if (rg.prev) doc.sections['ring:prev-run'] = tail(rg.prev, LIMITS.extraBytes);
                if (rg.now && reason.kind === 'manual') doc.sections['ring:this-run'] = tail(rg.now, LIMITS.extraBytes);
            } catch (e) { /* no ring */ }
            Object.assign(doc.sections, await extras(reason.kind));
            Object.keys(doc.sections).forEach((k) => { doc.sections[k] = scrub(relative(doc.sections[k]), secrets); });
            let sealed = null;
            for (let cut = 0; cut < 4; cut++) {
                const z = await new Promise((res, rej) => zlib.gzip(Buffer.from(JSON.stringify(doc)), { level: 6 }, (e, b) => e ? rej(e) : res(b)));
                await new Promise((r) => setImmediate(r));
                sealed = seal(z, drop.pub);
                if (sealed.length <= LIMITS.sealed) break;
                Object.keys(doc.sections).forEach((k) => { doc.sections[k] = tail(doc.sections[k], Math.floor(doc.sections[k].length / 2)); });
                sealed = null;
            }
            if (!sealed) return null;
            const name = new Date(now()).toISOString().replace(/[:.]/g, '-') + '-' + reason.kind + '-' + crypto.randomBytes(3).toString('hex') + '.ngrl';
            await new Promise((res) => fs.writeFile(path.join(outbox, name), sealed, () => res()));
            trimOutbox();
            note('info', 'bundle ' + reason.kind + ' ready (' + Math.round(sealed.length / 1024) + ' KB)');
            return name;
        }).catch((e) => { note('warn', 'bundle failed: ' + (e && e.message)); return null; });
        return busy;
    }
    function listOutbox() {
        try {
            return fs.readdirSync(outbox).filter((f) => /\.ngrl$/.test(f)).sort().map((f) => {
                const st = fs.statSync(path.join(outbox, f)); return { name: f, size: st.size, at: st.mtime.getTime() };
            });
        } catch (e) { return []; }
    }
    function trimOutbox() {
        let l = listOutbox();
        const drop = (f) => { try { fs.unlinkSync(path.join(outbox, f.name)); } catch (e) {} };
        l.filter((f) => now() - f.at > LIMITS.maxAgeMs).forEach(drop);
        l = listOutbox();
        while (l.length > LIMITS.outboxFiles || l.reduce((s, f) => s + f.size, 0) > LIMITS.outboxBytes) { drop(l.shift()); }
    }

    /* --- upload --- */
    function sent(ok, msg) {
        state.lastSent = { at: now(), ok, msg };
        saveState();
        sharedWrite('status-' + o.id + '.json', { app: o.id, at: now(), ok, msg, pending: listOutbox().length });
    }
    function kick(ms) {
        if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
        retryTimer = setTimeout(() => { retryTimer = null; upload(); }, ms || 0);
        if (retryTimer.unref) retryTimer.unref();
    }
    async function upload() {
        if (uploading || blocked) return;
        const drop = readDrop(o.dataDir);
        if (drop.state !== 'ok' || !enabled()) return;
        const files = listOutbox();
        if (!files.length) return;
        uploading = true;
        try {
            for (const f of files) {
                const data = await new Promise((res) => fs.readFile(path.join(outbox, f.name), (e, b) => res(e ? null : b)));
                if (!data) continue;
                const p = '/repos/' + drop.repo + '/contents/' + drop.dir + '/' + o.id + '/' + f.name;
                const body = JSON.stringify({ message: o.id + ' ' + o.version + ' log', content: data.toString('base64') });
                const r = await request('PUT', drop.api + p, {
                    Authorization: 'Bearer ' + drop.token, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json',
                    'User-Agent': 'ng-remotelog/1', 'X-GitHub-Api-Version': '2022-11-28',
                }, body);
                if (r.status === 200 || r.status === 201 || r.status === 422) {
                    try { fs.unlinkSync(path.join(outbox, f.name)); } catch (e) {}
                    failures = 0;
                    sent(true, 'sent');
                    note('info', 'bundle sent');
                } else if (r.status === 401 || r.status === 403 || r.status === 404) {
                    blocked = true;
                    sent(false, r.status === 401 ? 'token rejected' : 'no access to the drop');
                    note('warn', 'upload refused: HTTP ' + r.status);
                    return;
                } else throw new Error('HTTP ' + r.status);
            }
        } catch (e) {
            const wait = backoff[Math.min(failures, backoff.length - 1)];
            failures++;
            sent(false, 'retrying (' + String(e && e.message || e).slice(0, 40) + ')');
            note('info', 'upload failed, again in ' + Math.round(wait / 1000) + ' s');
            kick(wait);
        } finally { uploading = false; }
    }

    /* --- the running side --- */
    function crashAllowed() {
        state.crashes = (state.crashes || []).filter((t) => now() - t < 24 * 3600e3);
        if (state.crashes.length >= LIMITS.crashPerDay) return false;
        state.crashes.push(now()); saveState(); return true;
    }
    /** "Send logs now": this app's bundle, and a request the other apps pick up */
    function sendNow() {
        if (readDrop(o.dataDir).state !== 'ok') return Promise.resolve(null);
        sharedWrite('request.json', { at: now(), from: o.id });
        return manual();
    }
    function manual() {
        if (now() - (state.manualAt || 0) < LIMITS.manualGapMs) { kick(0); return Promise.resolve(null); }
        state.manualAt = now(); saveState();
        blocked = false; failures = 0;
        return bundle({ kind: 'manual', why: 'asked from Diagnostics' }, session && session.started).then((n) => { kick(0); return n; });
    }
    function pollRequests() {
        const r = sharedRead('request.json');
        if (r && r.at > lastReq && r.from !== o.id) { lastReq = r.at; if (session && r.at > session.started) manual(); }
    }
    /* --- 0.13.8: a crash bundle waiting for the drop (not there yet at start): made once it is --- */
    let crashWaiting = null;
    function crashBundle() {
        if (readDrop(o.dataDir).state !== 'ok') { crashWaiting = crash; return Promise.resolve(null); }
        crashWaiting = null;
        if (!crashAllowed()) return Promise.resolve(null);
        return bundle(crash, previous && previous.started).then((n) => { kick(0); return n; });
    }
    function poll() {
        pollRequests();
        if (crashWaiting && readDrop(o.dataDir).state === 'ok') { note('info', 'the drop is there now: the crash bundle made'); crashBundle(); }
    }

    /* --- 0.13.8: health lines for the ring only (the event loop's lag, the memory), cheap, rate-limited --- */
    const H = Object.assign({ sampleMs: 5000, activeMs: 10000, idleMs: 60000, lagNowMs: 200, lagNoteMs: 50, stepMiB: 1 }, o.health || {});
    const actives = [];
    const hs = { max: 0, sum: 0, n: 0, at: 0, last: null, lines: 0 };
    const mib = (b) => Math.round(b / 1048576 * 10) / 10;
    /** one sample: lag (ms) of the timer that measured it; a line when due */
    function healthSample(lag) {
        if (!ring.on) { hs.max = 0; hs.sum = 0; hs.n = 0; return null; }
        lag = Math.max(0, Math.round(lag));
        hs.max = Math.max(hs.max, lag); hs.sum += lag; hs.n++;
        const t = now(), active = actives.some((f) => { try { return !!f(); } catch (e) { return false; } });
        const m = process.memoryUsage(), cur = { rss: mib(m.rss), heap: mib(m.heapUsed), total: mib(m.heapTotal) };
        const moved = !hs.last || Math.abs(cur.rss - hs.last.rss) >= H.stepMiB || Math.abs(cur.heap - hs.last.heap) >= H.stepMiB || hs.max >= H.lagNoteMs;
        const gap = t - hs.at;
        const due = lag >= H.lagNowMs || (active ? gap >= H.activeMs && (moved || gap >= H.idleMs) : gap >= H.idleMs);
        if (!due) return null;
        const line = 'health: lag max ' + hs.max + ' ms, avg ' + Math.round(hs.sum / hs.n) + ' ms over ' + hs.n + '; rss ' + cur.rss + ' MiB, heap ' + cur.heap + ' of ' + cur.total + ' MiB' + (active ? '; cluster on' : '');
        hs.max = 0; hs.sum = 0; hs.n = 0; hs.at = t; hs.last = cur; hs.lines++;
        try { ring.note('INFO', line); } catch (e) {}
        return line;
    }
    function healthStart() {
        let due = 0;
        const go = () => {
            due = Date.now() + H.sampleMs;
            const h = setTimeout(() => { try { healthSample(Date.now() - due); } catch (e) {} if (timers.indexOf(h) >= 0) { timers.splice(timers.indexOf(h), 1); go(); } }, H.sampleMs);
            if (h.unref) h.unref();
            timers.push(h);
        };
        go();
    }

    function start() {
        const t = (fn, ms) => { const h = setInterval(fn, ms); if (h.unref) h.unref(); timers.push(h); };
        t(beat, BEAT_MS);
        t(poll, 15e3);
        try { ring.start(); } catch (e) {}
        if (o.health !== false) healthStart();
        const r = sharedRead('request.json'); lastReq = r ? r.at : 0;
        const d = setTimeout(() => {
            if (crash) crashBundle();
            else kick(0);
        }, o.startDelay === undefined ? 20e3 : o.startDelay);
        if (d.unref) d.unref();
        timers.push(d);
    }
    function stop() { timers.forEach((h) => { clearInterval(h); clearTimeout(h); }); timers = []; if (retryTimer) clearTimeout(retryTimer); try { ring.stop(); } catch (e) {} }

    function status() {
        const drop = readDrop(o.dataDir);
        const others = [];
        try { fs.readdirSync(shared).filter((f) => /^status-.+\.json$/.test(f) && f !== 'status-' + o.id + '.json').forEach((f) => { const s = sharedRead(f); if (s) others.push(s); }); } catch (e) {}
        return { setup: drop.state, why: drop.why, on: enabled(), lastSent: state.lastSent, pending: listOutbox().length, uploading, crash, others };
    }
    return {
        begin, start, stop, end, fatal, status, sendNow, setEnabled, share, bundle, upload, kick, listOutbox,
        /** a log line for the ring (mgu.js's file log); nothing when the ring is off */
        ring(level, msg) { try { ring.note(level, msg); } catch (e) {} },
        get ringLog() { return ring; },
        context(name, fn) { contexts.push({ name, fn }); },
        /** 0.13.8: fn() true while the HUD / dials are on (health lines every 10 s then, else every minute) */
        active(fn) { if (typeof fn === 'function') actives.push(fn); },
        healthSample, poll, get crashWaiting() { return crashWaiting; }, _health: () => Object.assign({}, hs),
        get crash() { return crash; }, _state: () => state,
    };
}

let instance = null;
module.exports = {
    create, scrub, seal, open, hkdf, readDrop, LIMITS,
    /** the app's recorder (mgu.js makes it), or null */
    get: () => instance, set: (r) => { instance = r; return r; },
};
