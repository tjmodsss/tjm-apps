'use strict';
/**
 * ringlog.js - the crash-surviving ring for the encrypted remote logs (remotelog.js; Node 8, no npm modules).
 *
 * The lines that explain a head unit crash or restart - HUD take-over / fail-safe, cluster renderer uploads
 * and memory, look switches, memory budget lines, warnings - are kept in a tiny ring on the app's own data
 * area (<data>/remotelog/ring, flash, not RAM), so they are still there after the unit restarts:
 *   - in memory first, written in one batch every FLUSH_MS (only when there is something new), and within
 *     EVENT_MS of a notable line (a HUD hand-over, a look switch, a memory warning, a failed upload, a warning);
 *   - one append per batch (open, write, close; no fsync), a flush to the flash itself (fdatasync) only after an
 *     urgent line (a warning, a HUD hand-over, a refusal, memory full) and at most once a minute;
 *   - SEGS segments of SEG_BYTES at most (the oldest dropped on rotation): this run's ring is at most
 *     SEGS x SEG_BYTES, the run before's the same, so the whole ring is never more than 2 x SEGS x SEG_BYTES
 *     on the flash (96 KB with the defaults) in at most 2 x SEGS files, none kept longer than 14 days;
 *   - at start the last run's segments become prev-*.log (replacing the run before's), for the next bundle.
 * Written only while the remote logs are set up (the unit's own drop file) and on; without a drop file
 * nothing is written and this run's ring is deleted (0.13.8: the run before's kept, aged out after 14 days, for a
 * crash bundle made once the drop is there). Never throws, never blocks: the timers are unref'd, the
 * regular writes asynchronous; only a fatal error / exit writes synchronously (what is still in memory).
 */
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
    flushMs: 5000,           // a batch at most this often (only when there are new lines)
    eventMs: 250,            // a notable line: written within this (lines arriving meanwhile go in the same batch)
    syncGapMs: 60000,        // fdatasync after an urgent line (below), at most this often
    gateMs: 60000,           // the drop file / the switch looked at again this often
    segBytes: 16 * 1024,     // one segment
    segs: 3,                 // segments of this run (and as many kept of the run before)
    lineMax: 400,            // one line at most (stacks folded onto one line)
    pendMax: 32 * 1024,      // waiting in memory at most (the oldest go first)
    maxAgeMs: 14 * 24 * 3600 * 1000,
    syncIO: false,           // tests only (a simulated clock): write at once
};

// what goes in the ring at all (level + ' ' + message)
const KEEP = /^(WARN|ERROR|FATAL|SDK_\w+) |^INFO (popup|health): |hud|cluster|renderer|memory|MiB|upload|refused|layer|fail-?safe|take.?over|budget|^INFO (look|displays|starting|exit code)\b/i;
// what is written at once
const NOW = /^(WARN|ERROR|FATAL|SDK_\w+) |^INFO (look|displays|popup)\b|^INFO [\w -]+: (hud |connected|disconnected|off$|shown|hidden|refused|making|made|the renderer lost)|take.?over|fail-?safe|renderer memory|memory is full|uploads last|refused|parked behind|scene is held/i;

// what is also flushed to the flash itself (fdatasync, rate-limited): a warning, a HUD hand-over, a refusal, memory full
// (the periodic watchdog / upload windows are written at once but left to the kernel's own writeback)
const SYNC = /^(WARN|ERROR|FATAL|SDK_\w+) |^INFO [\w -]+: hud |take.?over|memory is full|refused|parked behind|scene is held/i;

const SEG_RE = /^seg-(\d{6})\.log$/, PREV_RE = /^prev-(\d{6})\.log$/;

function create(o) {
    const c = Object.assign({}, DEFAULTS, o || {});
    const dir = c.dir, now = c.now || Date.now;
    const T = c.timers || { setTimeout, clearTimeout, setInterval, clearInterval };
    let on = false, pending = [], pendBytes = 0, seq = 0, curSize = -1, eventTimer = null, wantSync = false, lastSync = 0;
    let writing = false, again = false, timers = [], lastGate = 0;
    const stats = { lines: 0, dropped: 0, flushes: 0, writes: 0, syncs: 0, bytes: 0, rotations: 0, busyUs: 0 };
    const hr = () => { const t = process.hrtime(); return t[0] * 1e6 + t[1] / 1e3; };

    const list = (re) => { try { return fs.readdirSync(dir).filter((f) => re.test(f)).sort(); } catch (e) { return []; } };
    const rm = (f) => { try { fs.unlinkSync(path.join(dir, f)); } catch (e) { /* gone */ } };
    const segName = (n) => 'seg-' + ('00000' + n).slice(-6) + '.log';
    const header = () => '# ' + (c.id || '?') + ' ' + (c.version || '?') + ' run ' + new Date(now()).toISOString() + (c.boot ? ' boot ' + String(c.boot()).slice(0, 8) : '') + '\n';
    /** has a segment more than its header lines? */
    const hasLines = (f) => { try { return fs.readFileSync(path.join(dir, f), 'utf8').split('\n').some((l) => l && l[0] !== '#'); } catch (e) { return false; } };

    /** the gate: 'on', 'off' (kept, not written) or 'none' (no drop file: nothing kept) */
    function refresh() {
        let g = 'none';
        try { g = c.gate ? c.gate() : 'none'; } catch (e) { g = 'none'; }
        lastGate = now();
        // 0.13.8: no drop (yet): this run's segments deleted, the run before's kept (aged out after maxAgeMs) for a
        // crash bundle made once the drop is there (remotelog.js); clear() still deletes everything
        if (g === 'none') { clearRun(); on = false; }
        else on = g === 'on';
        if (!on) { pending = []; pendBytes = 0; }
        return g;
    }
    /** this run's files deleted, the run before's kept unless older than maxAgeMs */
    function clearRun() {
        list(SEG_RE).forEach(rm);
        list(/\.tmp$/).forEach(rm);
        list(PREV_RE).forEach((f) => { try { if (now() - fs.statSync(path.join(dir, f)).mtime.getTime() > c.maxAgeMs) rm(f); } catch (e) {} });
        if (!list(PREV_RE).length) { try { fs.rmdirSync(dir); } catch (e) { /* not empty or gone */ } }
        seq = 0; curSize = -1;
    }
    /** every file of the ring deleted */
    function clear() {
        let names = [];
        try { names = fs.readdirSync(dir); } catch (e) { return; }
        names.filter((f) => SEG_RE.test(f) || PREV_RE.test(f) || /\.tmp$/.test(f)).forEach(rm);
        try { fs.rmdirSync(dir); } catch (e) { /* not empty or gone */ }
        seq = 0; curSize = -1;
    }
    /** at start (sync, once): the last run's ring kept as prev-*, old files aged out, then the gate */
    function begin() {
        const segs = list(SEG_RE);
        if (segs.length && segs.some(hasLines)) {
            list(PREV_RE).forEach(rm);
            segs.forEach((f) => { try { fs.renameSync(path.join(dir, f), path.join(dir, 'prev-' + f.slice(4))); } catch (e) { rm(f); } });
        } else segs.forEach(rm);
        list(PREV_RE).forEach((f) => { try { if (now() - fs.statSync(path.join(dir, f)).mtime.getTime() > c.maxAgeMs) rm(f); } catch (e) {} });
        seq = 0; curSize = -1;
        return refresh();
    }

    /** one log line (from mgu.js's file log): cheap when off or not wanted */
    function note(level, msg) {
        if (!on) return;
        const s = level + ' ' + msg;
        if (!KEEP.test(s)) return;
        let line = new Date(now()).toISOString() + ' ' + s.replace(/\s*\n\s*/g, ' | ');
        if (line.length > c.lineMax) line = line.slice(0, c.lineMax - 3) + '...';
        pending.push(line); pendBytes += line.length + 1; stats.lines++;
        while (pendBytes > c.pendMax && pending.length > 1) { pendBytes -= pending.shift().length + 1; stats.dropped++; }
        if (NOW.test(s)) {
            if (SYNC.test(s)) wantSync = true;
            if (!eventTimer) { eventTimer = T.setTimeout(() => { eventTimer = null; flush(); }, c.eventMs); if (eventTimer && eventTimer.unref) eventTimer.unref(); }
        }
    }

    /** the batch to write and where: rotation decided here (sync bookkeeping, tiny) */
    function plan() {
        if (!pending.length) return null;
        let text = pending.join('\n') + '\n';
        pending = []; pendBytes = 0;
        try { fs.mkdirSync(dir); } catch (e) { /* there */ }
        if (curSize < 0) { seq = 1; curSize = 0; }
        let head = '';
        if (curSize === 0) head = header();
        else if (curSize + Buffer.byteLength(text) > c.segBytes) {
            seq++; stats.rotations++; curSize = 0; head = header();
            const keep = list(SEG_RE);
            // the new one counts: keep segs - 1 old ones
            keep.slice(0, Math.max(0, keep.length - (c.segs - 1))).forEach(rm);
        }
        const room = c.segBytes - head.length;
        if (Buffer.byteLength(text) > room) {
            // more than a segment in one batch: its newest lines, cut at a line start
            const b = Buffer.from(text);
            let cut = b.slice(b.length - room).toString('utf8');
            const k = cut.indexOf('\n');
            cut = k >= 0 ? cut.slice(k + 1) : '';
            text = cut;
        }
        const data = head + text;
        curSize += Buffer.byteLength(data);
        return { file: path.join(dir, segName(seq)), data };
    }

    /** the batch, asynchronously (one open / write / close; fdatasync only after a notable line, rate-limited) */
    function flush() {
        if (!on) return Promise.resolve(false);
        if (writing) { again = true; return Promise.resolve(false); }
        const t0 = hr();
        const p = plan();
        if (!p) { stats.busyUs += hr() - t0; return Promise.resolve(false); }
        const sync = wantSync && now() - lastSync >= c.syncGapMs;
        wantSync = false;
        if (sync) lastSync = now();
        writing = true; stats.flushes++;
        if (c.syncIO) {
            // tests on a simulated clock (no event loop turns between steps): the same writes, done at once
            try {
                const fd = fs.openSync(p.file, 'a', 0o600);
                try { fs.writeSync(fd, p.data); stats.writes++; stats.bytes += Buffer.byteLength(p.data); if (sync) { stats.syncs++; fs.fdatasyncSync(fd); } } finally { fs.closeSync(fd); }
            } catch (e) { /* not writable */ }
            writing = false; stats.busyUs += hr() - t0;
            return Promise.resolve(true);
        }
        stats.busyUs += hr() - t0;
        return new Promise((res) => {
            fs.open(p.file, 'a', 0o600, (e, fd) => {
                if (e) { writing = false; return res(false); }
                const buf = Buffer.from(p.data);
                fs.write(fd, buf, 0, buf.length, null, (e2) => {
                    if (!e2) { stats.writes++; stats.bytes += buf.length; }
                    const done = () => fs.close(fd, () => {
                        writing = false;
                        if (again) { again = false; if (pending.length) flush(); }
                        res(!e2);
                    });
                    if (sync && !e2) { stats.syncs++; fs.fdatasync(fd, done); } else done();
                });
            });
        });
    }
    /** what is still in memory, synchronously (a fatal error, the exit) */
    function flushSync() {
        if (!on) return false;
        const p = plan();
        if (!p) return false;
        try { fs.appendFileSync(p.file, p.data, { mode: 0o600 }); stats.writes++; stats.bytes += Buffer.byteLength(p.data); return true; } catch (e) { return false; }
    }

    function start() {
        const tick = () => {
            if (now() - lastGate >= c.gateMs) refresh();
            if (on && pending.length && !eventTimer) flush();
        };
        const h = T.setInterval(tick, c.flushMs); if (h && h.unref) h.unref();
        timers.push(h);
    }
    function stop() {
        timers.forEach((h) => T.clearInterval(h)); timers = [];
        if (eventTimer) { T.clearTimeout(eventTimer); eventTimer = null; }
        flushSync();
    }

    const readAll = (re) => list(re).map((f) => { try { return fs.readFileSync(path.join(dir, f), 'utf8'); } catch (e) { return ''; } }).join('');
    /** for a bundle: { prev: the run before's ring, now: this run's (with what is still in memory) } */
    function read() { return { prev: readAll(PREV_RE), now: readAll(SEG_RE) + (pending.length ? pending.join('\n') + '\n' : '') }; }
    /** the ring's files and their sizes (tests, Diagnostics) */
    function files() {
        return list(/^(seg|prev)-\d{6}\.log$/).map((f) => { let size = 0; try { size = fs.statSync(path.join(dir, f)).size; } catch (e) {} return { name: f, size }; });
    }
    return { begin, refresh, clear, note, flush, flushSync, start, stop, read, files, stats: () => Object.assign({ on, pending: pending.length }, stats), get on() { return on; } };
}

module.exports = { create, DEFAULTS, KEEP, NOW, SYNC, capBytes: (o) => { const c = Object.assign({}, DEFAULTS, o || {}); return 2 * c.segs * c.segBytes; } };
