'use strict';
/**
 * renderer.js - what the cluster-render service says, for the cover (output.js), the test ladder (ladder.js) and the
 * Safety page. Node 8. The pinned client (cluster_render_client.js, never edited) drops some event fields (a target's
 * `rendering` and `retry_in_ms`), so tap() reads the raw events it parses.
 *
 *   parseStatus(text)   the service's status text (idrive-apps server.cpp status_text) -> { cap, targets: { name: { state,
 *                       holder, reason, rendering, published } }, layers: [{ id, kind, app, target, state, reason }] }
 *   othersOn(st, names) other apps' layers on those targets: ['adam_shiftlights on hud', ...]
 *   busyOf(targets, mine) why the shared scene (panel and hud have one scene id, never up at once) is someone else's,
 *                       or '': the HUD wanted by anyone (M Track never draws there), the panel wanted while we hold no
 *                       layer on it, the panel waiting on that scene id, or slot 0x203 held by a foreign app
 *   warmOf(st)          the HUD's released scene still published: the panel's request then swaps the scene id, which
 *                       the service's README says once left a scene reported mapped and never drawn
 *   verdictOf(st)       after a drop or close: { ok, ours, panel, others } from a status reply
 *   tap(client, diag, onEvent)  every op the client sends goes to the diag log (uniforms, alive re-arms and stops
 *                       counted every 10 s), every event it gets too (a status the same as the last one counted);
 *                       onEvent(ev) sees each raw event first
 *   verifyRelease(o, why, done)  a watcher client that never makes a layer or asset: waits for the panel to go idle
 *                       (or o.cfg.renderer.verifyMs), asks for the status, logs the verdict and calls done(verdict)
 */
const MINE = /^adam_mtrack(-test|-watch)?$/;
const WANTED = ['acquiring', 'parked', 'shown', 'waiting', 'unavailable'];   // someone's layer wants the target
const wanted = (t) => !!t && WANTED.indexOf(t.state) >= 0;

function parseStatus(text) {
    const out = { cap: null, targets: {}, layers: [], assets: [] };
    String(text || '').split('\n').forEach((line) => {
        let m = /^upload: cap (\d+) KB\/s/.exec(line);
        if (m) { out.cap = Number(m[1]); return; }
        m = /^asset (\d+) (r8|rgba8) (\d+)x(\d+) of (\S+) on (\w+): (\d+) writes, \d+ KB, (\d+) failed/.exec(line);
        if (m) { out.assets.push({ id: Number(m[1]), format: m[2], w: Number(m[3]), h: Number(m[4]), app: m[5], target: m[6], writes: Number(m[7]), failed: Number(m[8]) }); return; }
        m = /^target (\w+): slot \S+ scene \S+ \d+x\d+: (\w+)(?: \((\w+)\))?(.*)$/.exec(line);
        if (m) {
            const rest = m[4], semi = rest.indexOf('; ');
            const reason = (semi >= 0 ? rest.slice(0, semi) : rest).trim(), rendering = semi >= 0 ? rest.slice(semi + 2).trim() : '';
            out.targets[m[1]] = { state: m[2], holder: m[3] || '', reason, rendering, published: rendering === 'scene published' };
            return;
        }
        m = /^layer (\d+) (\w+) of (\S+) on (\w+), (\w+) z (-?\d+)[^:]*: (\w+)(?: - (.*))?$/.exec(line);
        if (m) out.layers.push({ id: Number(m[1]), kind: m[2], app: m[3], target: m[4], klass: m[5], z: Number(m[6]), state: m[7], reason: m[8] || '' });
    });
    return out;
}

const othersOn = (st, names) => (st ? st.layers : []).filter((l) => !MINE.test(l.app) && names.indexOf(l.target) >= 0)
    .map((l) => l.app + ' on ' + l.target).filter((x, i, a) => a.indexOf(x) === i);

function busyOf(targets, mine) {
    const p = targets.panel, h = targets.hud;
    if (p && p.state === 'waiting' && /scene id in use/.test(p.reason || '')) return 'the panel waits: its scene id is in use';
    if (p && p.holder === 'foreign' && (p.state === 'waiting' || p.state === 'parked')) return 'another app\'s content holds slot 0x203';
    if (wanted(h)) return 'the HUD is ' + h.state;
    if (!mine && wanted(p)) return 'the panel is ' + p.state + ' for another app';
    return '';
}

const warmOf = (st) => !!(st && st.targets.hud && st.targets.hud.published && !wanted(st.targets.hud));

/** app's assets on target in a parsed status: { listed, unwritten (no write yet), failed (writes failed so far) }. */
function uploadsOf(st, app, target) {
    const r = { listed: 0, unwritten: 0, failed: 0 };
    (st ? st.assets : []).forEach((a) => { if (a.app === app && a.target === target) { r.listed++; if (a.writes < 1) r.unwritten++; r.failed += a.failed; } });
    return r;
}
/** Every app's assets as cluster-render counts them against its pixel memory (each asset's pixels twice): { all, mine, others: ['app 1.2 MiB'] }. */
function memoryOf(st, app) {
    const by = {};
    let all = 0, mine = 0;
    (st ? st.assets : []).forEach((a) => {
        const b = a.w * a.h * (a.format === 'r8' ? 1 : 4) * 2;
        all += b;
        if (a.app === app) mine += b; else by[a.app] = (by[a.app] || 0) + b;
    });
    return { all, mine, others: Object.keys(by).map((k) => k + ' ' + (by[k] / 1048576).toFixed(1) + ' MiB') };
}
/** Our layer of class / z on target in a parsed status: its state and reason, or null when not listed. */
const layerOf = (st, app, target, z) => (st ? st.layers : []).filter((l) => l.app === app && l.target === target && l.z === z)[0] || null;

function verdictOf(st) {
    const p = (st && st.targets.panel) || {};
    const ours = (st ? st.layers : []).filter((l) => MINE.test(l.app) && (l.target === 'panel' || l.target === 'hud')).length;
    const others = othersOn(st, ['panel', 'hud']);
    return { ok: ours === 0 && (p.state === 'idle' || p.state === 'lingering' || !p.state), ours, panel: p.state || 'unknown', others };
}

/** One line for the log and the Safety page. */
function verdictText(v, why) {
    if (v.unreachable) return 'release (' + why + '): renderer not reachable, nothing of ours can show';
    if (v.ok) return 'release confirmed (' + why + '): panel ' + v.panel + ' ' + (v.ms / 1000).toFixed(1) + ' s after, the renderer status lists none of our layers';
    return 'release NOT confirmed (' + why + '): ' + (v.ours ? v.ours + ' of our layers still listed' : 'our layers gone') + ', panel ' + v.panel +
        (v.others.length ? ', ' + v.others.join(', ') : '') + ' after ' + (v.ms / 1000).toFixed(1) + ' s';
}

/** The same, short, for the Safety page. */
function verdictShort(v) {
    if (v.unreachable) return 'Released: cluster-render not reachable, nothing of ours can show';
    const s = (v.ms / 1000).toFixed(1) + ' s';
    if (v.ok) return 'Released: panel ' + v.panel + ' ' + s + ' after, status lists none of ours';
    return 'NOT released: panel ' + v.panel + (v.ours ? ', ' + v.ours + ' of ours listed' : '') + (v.others.length ? ', ' + v.others.slice(0, 2).join(', ') : '') + ' (' + s + ')';
}

function sendLine(m) {
    const o = Object.assign({}, m);
    if (typeof o.fs === 'string') o.fs = o.fs.length + ' chars';
    if (typeof o.vs === 'string') o.vs = o.vs.length + ' chars';
    return '> ' + JSON.stringify(o);
}

function tap(c, diag, onEvent) {
    const send = c._send, event = c._event, n = { uniform: 0, alive: 0, stop: 0 };
    let since = Date.now(), lastStatus = null, same = 0;
    c._send = function (m) {
        if (c.sock !== undefined && !c.connected) return send.call(this, m);   // not on the wire: the replay on connect sends (and logs) it
        // the dead-man re-arms ~17 times a second a layer (an animate and a stop each): counted every 10 s, never one by one
        if (m && (m.op === 'uniform' || m.op === 'stop' || (m.op === 'animate' && m.name === 'u_alive'))) {
            n[m.op === 'animate' ? 'alive' : m.op]++;
            const now = Date.now();
            if (now - since >= 10000 || now < since) {
                diag('> ' + c.app + ' sent ' + n.uniform + ' uniforms, ' + n.alive + ' alive re-arms, ' + n.stop + ' stops in ' + Math.round((now - since) / 1000) + ' s');
                n.uniform = 0; n.alive = 0; n.stop = 0; since = now;
            }
        } else diag(sendLine(m));
        return send.call(this, m);
    };
    c._event = function (ev) {
        if (onEvent) onEvent(ev);
        // a status asked again while a stage waits is often the same text: logged once, then counted
        if (ev && ev.ev === 'status' && ev.text === lastStatus) same++;
        else {
            if (same) diag('< status: the same again, ' + same + ' times');
            same = 0;
            if (ev && ev.ev === 'status') lastStatus = ev.text;
            diag('< ' + (ev && ev.ev === 'status' ? 'status: ' + ev.text : JSON.stringify(ev)));
        }
        return event.call(this, ev);
    };
}

function verifyRelease(o, why, done) {
    const t0 = Date.now(), c = new o.ClusterRender('adam_mtrack-watch', o.socketPath), R = o.cfg.renderer;
    let over = false, asked = false, timer = null;
    const finish = (v) => {
        if (over) return;
        over = true;
        clearTimeout(timer);
        c.close();
        v.ms = Date.now() - t0;
        const text = verdictText(v, why);
        if (v.ok || v.unreachable) o.log.info(text); else o.log.warn(text);
        o.diag(text);
        done(Object.assign(v, { text, short: verdictShort(v), why, at: Date.now() }));
    };
    const ask = () => { if (!asked && c.ready) { asked = true; c.status(); } };
    tap(c, o.diag, o.guard('watch event', (ev) => {
        if (ev.ev === 'target' && ev.target === 'panel' && (ev.state === 'idle' || ev.state === 'unavailable')) ask();
        else if (ev.ev === 'status') finish(verdictOf(parseStatus(ev.text)));
    }));
    timer = setTimeout(o.guard('watch timeout', () => {
        if (!c.ready) { finish({ ok: false, unreachable: true, ours: 0, panel: 'unknown', others: [] }); return; }
        ask();
        timer = setTimeout(o.guard('watch status', () => finish({ ok: false, ours: 0, panel: 'no status reply', others: [] })), 1500);
    }), R.verifyMs);
    c.connect();
}

module.exports = { MINE, WANTED, parseStatus, othersOn, busyOf, warmOf, uploadsOf, memoryOf, layerOf, verdictOf, verdictText, verdictShort, tap, verifyRelease };
