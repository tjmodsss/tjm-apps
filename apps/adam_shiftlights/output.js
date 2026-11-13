'use strict';
/**
 * output.js - the cluster / HUD side: the cluster-render layers the display mode and the two styles want.
 *
 *   const out = createOutput({ ClusterRender, socketPath, log, cfg, guard, makeCanvas, timers?, checkTimers?, onChange?, onRebuildDue? });
 *   out.apply({ display, active, sel, states, rpm, th, gear, flashMode });   // on every sample or setting change;
 *       // sel: { cluster, hud } (logic.readStyle), states: { cluster, hud } (logic.step for each style's count),
 *       // flashMode: 'app' (default) | 'renderer' (logic.readFlashMode)
 *   out.status() -> { link: 'none' | 'connecting' | 'ready', layers: { 'target role': state }, targets: { name: state }, flash, proof }
 *   out.requestStatus()   ask the service for its status text now (the Check tab); out.rebuild(why) the self-heal (0.4.4)
 *
 * 0.4.4, the read-back: the service's status text (crstatus.js) is asked verifyMs after each connect, 500 ms after a target
 * or layer event, every statusMs while layers exist and on requestStatus(). proof = { link, backend, holding, madeAt,
 * targets: { name: { state, holder, reason, at } }, layers: [{ which, target, role, ref, state, reason, lastSent, lastSentAt }],
 * status: { at, targets, others, rendering, guard, dcsm } | null, linkAt (the last ready), restartedAt (a ready after the service
 * dropped this link: it restarted, as a guard-reset or a Store update does; never after our own rebuild) } feeds hudcheck.verdict.
 * 0.4.5: the logged status line carries the mapping guard lines and the Dcsm2 state; the whole status text (asset and stats
 * lines left out, 1500 characters at most) is logged as 'cluster-render status (full):' on the first status after each ready
 * and whenever a guard line or the Dcsm2 up / down changes, RAW_LOG_MAX times a start at most. rebuild(why): drop every layer, close the
 * socket, make nothing for gapMs (a scene id dropped and published again within a second was reported never drawn), then
 * o.onRebuildDue() asks for a refresh that makes them again. o.onChange() on every link, target, layer, status or rebuild change.
 *
 * The plan (geom.layersFor) is keyed on every layer's place and style and the flash mode, not its brightness: a new key
 * drops the old layers and makes the new ones on the open connection (a style switch is live); nothing active
 * (off, kill switch, tripped, demo data) drops every layer and closes the connection. Uniforms go only when
 * they change; brightness is u_st on the effects and `opacity` on the bracket image.
 * The flash (u_st.y 1) shows the hull when u_on is 1 and nothing when it is 0. Flash mode App (0.4.3 default): the app
 * sends u_on 1 / 0 every half cycle (at most 8 times a second a layer), u_on 1 before the first u_st with the flash, every
 * flashing layer in step, and stops the moment no layer flashes. Renderer (0.4.2): one step animation of u_on that the
 * renderer plays, nothing sent per frame; on Adam's G01 it never ran (the KOMBI plays animations on its own clock), so
 * u_on kept its 1 and the bar stayed solid red.
 * The bracket image is drawn once (hudart.js) and sent whole; a gear change sends only the digit's box.
 */
const { FS_SLATS, FS_BRACKET, slatUniforms, bracketUniforms, unlitAlpha } = require('./shader');
const geom = require('./geom');
const hudart = require('./hudart');
const L = require('./logic');
const CS = require('./crstatus');
const HC = require('./hudcheck');

// Flash mode App: never more than 8 sends a second a layer (4 Hz), whatever flashHz says
const APP_HALF_MIN_MS = 125;
const STATUS_DEBOUNCE_MS = 500;     // a status this long after the last target or layer event
const STATUS_LOG_MAX = 200;         // 'target ...' status lines logged a start at most (one per new line)
const RAW_LOG_MAX = 30;             // 'cluster-render status (full):' dumps a start at most
const RAW_MAX = 1500;               // characters of one full dump

/** The status text on one line: asset lines and indented stats lines left out, cut to RAW_MAX. */
const rawLine = (text) => String(text || '').split('\n').filter((l) => l && !/^\s/.test(l) && !/^asset /.test(l)).join(' | ').slice(0, RAW_MAX);

function createOutput(o) {
    const cfg = o.cfg, log = o.log, guard = o.guard, T = o.timers || { setInterval, clearInterval };
    // the HUD check's own timers (status asks, the rebuild gap): o.checkTimers in tests, else the real ones
    const CT = Object.assign({ setInterval, clearInterval, setTimeout, clearTimeout }, o.checkTimers);
    const HCF = cfg.hudCheck || L.DEFAULTS.hudCheck;
    let cr = null, planKey = '[]', layers = [], linkState = 'none', ticker = null, phase = 1, skipped = 0;
    let madeAt = null, linkAt = null, holdFrom = 0, holdUntil = 0, lastStatus = null, statusLogged = 0, lastLines = '';
    let restartedAt = null, rawLogged = 0, rawNext = false, lastRawKey = null;
    const timers = { verify: null, debounce: null, poll: null, rebuild: null };
    const layerStates = Object.create(null), targetStates = Object.create(null), warned = Object.create(null);
    const layerReasons = Object.create(null), targetInfo = Object.create(null);
    const changed = () => { if (typeof o.onChange === 'function') guard('hud check change', o.onChange)(); };
    const clear = (k) => { if (timers[k]) { (k === 'poll' ? CT.clearInterval : CT.clearTimeout)(timers[k]); timers[k] = null; } };
    const later = (k, ms, fn) => { clear(k); timers[k] = CT.setTimeout(guard('hud check ' + k, () => { timers[k] = null; fn(); }), ms); };
    function askStatus() { if (cr && linkState === 'ready') cr.status(); }
    const warn = (text) => { if (!warned[text]) { warned[text] = true; log.warn(text); } };
    const appHalf = Math.max(APP_HALF_MIN_MS, Math.round(500 / cfg.flashHz));

    function client() {
        if (cr) return cr;
        cr = new o.ClusterRender('adam_shiftlights', o.socketPath);
        linkState = 'connecting';
        const c = cr;
        let dropped = false;        // this client saw the service go: its next ready is a service restart
        c.on('ready', guard('cr ready', () => {
            if (cr !== c) return;
            linkState = 'ready';
            linkAt = Date.now();
            rawNext = true;
            if (dropped) { dropped = false; restartedAt = linkAt; }
            log.info('cluster-render: connected (' + c.backend + ', ' + c.targets + ')' + (restartedAt === linkAt ? ': the service restarted' : ''));
            later('verify', HCF.verifyMs, askStatus);
            changed();
        }));
        c.on('disconnected', guard('cr disconnected', () => { if (cr === c) { dropped = true; linkState = 'connecting'; lastStatus = null; log.warn('cluster-render: connection lost, reconnecting'); changed(); } }));
        c.on('layer', guard('cr layer', (ref, state, reason) => {
            if (cr !== c || layerStates[ref] === state) return;
            layerStates[ref] = state;
            layerReasons[ref] = reason || '';
            log.info('cluster-render: layer ' + ref + ' ' + state + (reason ? ' (' + reason + ')' : ''));
            later('debounce', STATUS_DEBOUNCE_MS, askStatus);
            changed();
        }));
        c.on('target', guard('cr target', (name, state, holder, reason) => {
            if (cr !== c) return;
            targetStates[name] = state;
            targetInfo[name] = { state, holder: holder || '', reason: reason || '', at: Date.now() };
            log.info('cluster-render: target ' + name + ' ' + state + (holder ? ' holder ' + holder : '') + (reason ? ' (' + reason + ')' : ''));
            later('debounce', STATUS_DEBOUNCE_MS, askStatus);
            changed();
        }));
        c.on('status', guard('cr status', (text) => {
            if (cr !== c) return;
            const st = CS.parseStatus(text), rendering = {};
            Object.keys(st.targets).forEach((k) => { rendering[k] = CS.renderingOf(st.targets[k].rendering); });
            lastStatus = { at: Date.now(), targets: st.targets, others: CS.othersOn(st, HC.SHARED), rendering, guard: st.guard, dcsm: st.dcsm };
            // the target and guard lines (ours and the shared scene's) and the Dcsm2 state (not its seconds), logged when they change
            const ours = (k) => layers.some((l) => l.target === k) || HC.SHARED.indexOf(k) >= 0;
            const link = st.dcsm ? 'dcsm: Dcsm2 ' + (st.dcsm.up ? 'available' : 'not available') : '';
            const lines = Object.keys(st.targets).filter(ours).map((k) => st.targets[k].line)
                .concat(Object.keys(st.guard).filter(ours).map((k) => st.guard[k].line), link ? [link] : [])
                .concat(lastStatus.others.length ? ['others: ' + lastStatus.others.join(', ')] : []).join(' | ');
            if (lines !== lastLines && statusLogged < STATUS_LOG_MAX) { statusLogged++; log.info('cluster-render status: ' + (lines || 'no target lines')); }
            lastLines = lines;
            // the whole text: on the first status after a ready, and when a guard line or the Dcsm2 up / down changes
            const rawKey = JSON.stringify([Object.keys(st.guard).map((k) => st.guard[k].line), st.dcsm ? st.dcsm.up : null]);
            if ((rawNext || rawKey !== lastRawKey) && rawLogged < RAW_LOG_MAX) { rawLogged++; log.info('cluster-render status (full): ' + rawLine(text)); }
            rawNext = false;
            lastRawKey = rawKey;
            changed();
        }));
        c.on('refused', guard('cr refused', (op, ref, reason) => { if (cr === c) log.error('cluster-render refused ' + op + ' ' + ref + ': ' + reason); }));
        c.connect();
        return c;
    }

    function dropAll() {
        stopTicker();
        clear('poll');
        layers.forEach((l) => { delete layerStates[l.ref]; delete layerReasons[l.ref]; if (cr) cr.drop(l.ref); });
        layers = [];
        madeAt = null;
    }
    const sent = (l, what) => { l.lastSent = what; l.lastSentAt = Date.now(); };

    const box = (cv, r) => {            // the rows of rect r of a canvas, packed (an image update)
        const out = Buffer.alloc(r.w * r.h * 4);
        for (let y = 0; y < r.h; y++) Buffer.from(cv.d.buffer, cv.d.byteOffset + ((r.y + y) * cv.w + r.x) * 4, r.w * 4).copy(out, y * r.w * 4);
        return out;
    };
    const validGear = hudart.glyphOf;   // '1'..'9', 'P', 'R', 'N' or ''

    function make(spec, a) {
        const r = spec.rect, level = L.levelOf(cfg, a.sel[spec.which]);
        const base = { spec, role: spec.role, which: spec.which, target: r.target, st: '', flash: -1, anim: 0, on: 1, mode: a.flashMode === 'renderer' ? 'renderer' : 'app', level };
        if (spec.role === 'bracketImg') {
            const cv = o.makeCanvas(r.w, r.h), b = spec.geom;
            hudart.drawBracketStatic(cv, b, cfg.colors, -r.x, -r.y, 1);
            const ref = cr.image({ target: r.target, klass: 'overlay', z: spec.z, x: r.x, y: r.y, w: r.w, h: r.h, opacity: level });
            if (!ref) { log.error('cluster-render: image layer refused by the client for ' + r.target); return null; }
            const plain = new Uint8Array(cv.d);         // the art without a gear: the gear box is restored from it
            const gb = b.gearBox, gbox = { x: gb.x - r.x, y: gb.y - r.y, w: gb.w, h: gb.h };
            const gear = validGear(a.gear);
            hudart.drawGear(cv, b, gear, cfg.colors.rail, -r.x, -r.y, 1);
            cr.pixels(ref, null, Buffer.from(cv.d.buffer, cv.d.byteOffset, cv.d.length));
            return Object.assign(base, { ref, cv, plain, gbox, gear, lastSent: 'opacity ' + level + ', gear ' + (gear || '-'), lastSentAt: Date.now() });
        }
        const isFill = spec.role === 'bracketFill';
        const ref = cr.effect({ target: r.target, x: r.x, y: r.y, w: r.w, h: r.h, fs: isFill ? FS_BRACKET : FS_SLATS, klass: 'overlay', z: spec.z });
        if (!ref) { log.error('cluster-render: layer refused by the client for ' + r.target); return null; }
        const u = isFill ? bracketUniforms(spec, cfg.colors, level, a.th, cfg.hudStyles.cells) : slatUniforms(spec, cfg.colors, level);
        u.forEach((x) => cr.uniform(ref, x[0], x[1], x[2]));
        const st = u.filter((x) => x[0] === 'u_st')[0][1];
        return Object.assign(base, { ref, st: st.join(' '), lastSent: 'u_st ' + st.join(' '), lastSentAt: Date.now() });
    }

    const sendOn = (l, v) => { if (l.on !== v) { l.on = v; cr.uniform(l.ref, 'u_on', [v]); } };
    const appFlashing = () => layers.filter((l) => l.flash === 1 && l.mode === 'app');

    function stopTicker() {
        if (ticker) { T.clearInterval(ticker); ticker = null; }
    }
    /** Every App-flashing layer to its on half now, then a toggle every half cycle (one clock: all in step). */
    function startTicker() {
        stopTicker();
        phase = 1;
        appFlashing().forEach((l) => sendOn(l, 1));
        ticker = T.setInterval(guard('flash', flashTick), appHalf);
    }
    function flashTick() {
        const on = appFlashing();
        if (!on.length || !cr) { stopTicker(); return; }
        // the socket is backed up (an image upload, a stalled service): skip this toggle rather than queue it
        if (cr.blocked) { skipped++; return; }
        phase = phase ? 0 : 1;
        on.forEach((l) => sendOn(l, phase));
    }

    /** Before the layer's u_st: a flash starts in its on half (App: u_on 1 goes first), the animation (Renderer) or the ticker. */
    function startFlash(l, flash) {
        if (flash === l.flash) return;
        l.flash = flash;
        if (l.anim) { cr.stop(l.ref, l.anim); l.anim = 0; }
        if (l.mode === 'renderer') {
            if (flash) {
                const half = Math.round(500 / cfg.flashHz);
                l.anim = cr.animate(l.ref, { property: 'uniform', name: 'u_on', keys: '0:1 ' + half + ':0 ' + (2 * half) + ':1', loop: true, interp: 'step' });
            }
            return;
        }
        if (flash) startTicker();
        else if (!appFlashing().length) stopTicker();
    }

    function sendSt(l, v) {
        const s = v.join(' ');
        if (s !== l.st) { l.st = s; cr.uniform(l.ref, 'u_st', v); sent(l, 'u_st ' + s); }
    }

    function update(l, a) {
        const s = a.sel[l.which], level = L.levelOf(cfg, s);
        const st = (a.states && a.states[l.which]) || { lit: 0, flashing: false };
        if (l.role === 'bracketImg') {
            if (level !== l.level) { l.level = level; cr.set(l.ref, { opacity: level }); sent(l, 'opacity ' + level + ', gear ' + (l.gear || '-')); }
            const g = validGear(a.gear);
            if (g !== l.gear) {
                l.gear = g;
                const r = l.spec.rect, gb = l.gbox;
                for (let y = 0; y < gb.h; y++) {
                    const i = ((gb.y + y) * l.cv.w + gb.x) * 4;
                    l.cv.d.set(l.plain.subarray(i, i + gb.w * 4), i);
                }
                hudart.drawGear(l.cv, l.spec.geom, g, cfg.colors.rail, -r.x, -r.y, 1);
                cr.pixels(l.ref, [gb], box(l.cv, gb));
                sent(l, 'opacity ' + l.level + ', gear ' + (g || '-'));
            }
            return;
        }
        l.level = level;
        const flash = st.flashing ? 1 : 0;
        startFlash(l, flash);           // first: App's u_on 1 goes before the u_st that starts the flash
        if (l.role === 'slats') {
            sendSt(l, [st.lit, flash, level, unlitAlpha(l.spec.geom.style)]);
            return;
        }
        // bracketFill: the fill up to the rpm (10 rpm steps), red and flashing with the display's shift flash (every style)
        const b = l.spec.geom;
        const rpm = typeof a.rpm === 'number' && isFinite(a.rpm) ? Math.round(a.rpm / 10) * 10 : 0;
        sendSt(l, [Math.round(b.sOf(rpm) * 100) / 100, flash, level, 0]);
    }

    function apply(a) {
        const now = Date.now();
        if (holdUntil && (now >= holdUntil || now < holdFrom)) holdUntil = 0;     // the gap is over (or the clock went back)
        const want = a.active && a.sel && !holdUntil ? geom.layersFor(cfg, a.display, a.sel, warn) : [];
        const key = JSON.stringify([a.flashMode === 'renderer' ? 'renderer' : 'app'].concat(want.map((p) => [p.key, p.rect, p.style])));
        if (key !== planKey) {
            dropAll();
            planKey = key;
            if (want.length) {
                client();
                layers = want.map((p) => make(p, a)).filter(Boolean);
                madeAt = Date.now();
                log.info('cluster-render: layers ' + layers.map((l) => l.target + ' ' + l.role + '#' + l.ref).join(', '));
                timers.poll = CT.setInterval(guard('hud check poll', askStatus), HCF.statusMs);
                changed();
            }
        }
        if (!want.length) {
            Object.keys(targetStates).forEach((k) => { delete targetStates[k]; delete targetInfo[k]; });
            if (cr) { closeLink(); log.info('cluster-render: closed (nothing to show)'); }
            return;
        }
        layers.forEach((l) => update(l, a));
    }

    function closeLink() {
        ['verify', 'debounce'].forEach(clear);
        cr.close(); cr = null; linkState = 'none'; lastStatus = null;
    }

    /** The self-heal: drop and close now, nothing made for gapMs, then o.onRebuildDue() (main.js refreshes). */
    function rebuild(why) {
        const v = proofOf();
        log.warn('hud check: rebuild (' + why + '): ' + (v.layers.length ? v.layers.map((l) => l.target + ' ' + l.role + ' ' + l.state).join(', ') : 'no layers') +
            (lastStatus ? ', last status ' + JSON.stringify(lastLines) : ', no status yet') + ', guard ' + guardText());
        dropAll();
        Object.keys(targetStates).forEach((k) => { delete targetStates[k]; delete targetInfo[k]; });
        if (cr) closeLink();
        planKey = '[]';
        holdFrom = Date.now();
        holdUntil = holdFrom + HCF.gapMs;
        later('rebuild', HCF.gapMs, () => { holdUntil = 0; if (typeof o.onRebuildDue === 'function') guard('hud check rebuild due', o.onRebuildDue)(); });
        changed();
    }

    /** Our targets' guard state for the rebuild warning: 'hud disabled, 2 strikes', 'none' (no line), 'unknown' (no status). */
    function guardText() {
        if (!lastStatus) return 'unknown';
        const g = lastStatus.guard, k = Object.keys(g).filter((n) => layers.some((l) => l.target === n));
        return k.length ? k.map((n) => n + (g[n].disabled ? ' disabled, ' : ' ') + g[n].strikes + ' strike' + (g[n].strikes === 1 ? '' : 's')).join(', ') : 'none';
    }

    function proofOf() {
        const targets = {};
        Object.keys(targetInfo).forEach((k) => { targets[k] = Object.assign({}, targetInfo[k]); });
        return {
            link: linkState, backend: cr && cr.backend ? cr.backend : '', holding: !!holdUntil, madeAt, linkAt, restartedAt, targets, status: lastStatus,
            layers: layers.map((l) => ({ which: l.which, target: l.target, role: l.role, ref: l.ref, state: layerStates[l.ref] || 'sent',
                reason: layerReasons[l.ref] || '', lastSent: l.lastSent || '', lastSentAt: l.lastSentAt || null })),
        };
    }

    function status() {
        const out = {};
        layers.forEach((l) => { out[l.target + ' ' + l.role] = layerStates[l.ref] || 'sent'; });
        const targets = {};
        Object.keys(targetStates).forEach((k) => { targets[k] = targetStates[k]; });
        return { link: linkState, layers: out, targets, flash: { ticking: !!ticker, skipped }, proof: proofOf() };
    }

    return { apply, status, rebuild, requestStatus: askStatus };
}

module.exports = { createOutput };
