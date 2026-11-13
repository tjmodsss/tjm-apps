'use strict';
/**
 * output.js - what M Track puts on cluster-render's `panel` target, through one client: adam_mtrack for the cover (the
 * stages of stages.js coverStages), adam_mtrack-test for a test step (its own stages, or the plain test layers).
 *
 *   const out = createOutput({ ClusterRender, socketPath, log, cfg, guard, art, fault, diag, name, label, stages, deadman })
 *   out.arm(units)     connect; true when it armed anew (false: already armed for those units)
 *   out.show(frame)    build the stages if they are not built yet, then show them (below); call it again freely
 *   out.showTest(n)    the plain test steps (2 BAR, 3 TINT, 4 IMAGE): their layers made visible at once
 *   out.update(frame)  live uniforms, only those that changed
 *   out.box(n, px)     a live box's RGBA (panelL, panelR, cornerL, cornerR): only the changed rows' box goes, as
 *                      coverage + palette index (stages.encodeBox)
 *   out.tick(now)      the build's status asks, the hand-over wait, the stuck check; a release check's deadline
 *   out.pump(now)      the dead-man re-arm while shown (every cfg.safety.aliveRearmMs)
 *   out.wireStats()    { blocked, ticks }: pump ticks since the last call, and how many found the socket blocked; resets
 *   out.drop(why)      every layer dropped (removed, not hidden), the opaque tachs first; the build starts over on the
 *                      next show. The release is checked on this connection (status().release)
 *   out.disarm(why)    drop, then close the connection (the service removes the assets with it)
 *   out.requestStatus(why)  the service's status text, parsed into status().renderer (logged when why is given)
 *   out.status()       { link, armed, units, shown, target, holder, reason, rendering, uploaded, targets, cap, lastError,
 *                        layers, busy, warm, others, release, renderer, build }
 *
 * The build, G's Dash's call sequence (nickgcode/idrive7-apps fcluster.js) one stage at a time: nothing before the first
 * status answer; cfg.build.handoverMs after another app's HUD or panel let go of the shared scene id; then per stage:
 * its assets not sent yet (checked against the renderer's pixel memory first) and their pixels, its layer made HIDDEN,
 * a status; CONFIRMED by the answer to a status asked after the make, with no error event for its refs; LIFTED: u_alive
 * 0 and visible, drawn clear, so the renderer asks for the panel and writes the assets; WRITTEN when a status lists
 * every asset of ours with a write; then its samplers bound and its static uniforms sent, and the next stage. SHOWN
 * once every stage is: the live uniforms, u_alive 1 (the client's own value while shown, so a KOMBI that does not play
 * renderer animations still draws it: the 0.1.1 cover's fault) and the dead-man animation, the top layer first and
 * the opaque tachs last. A refusal, a layer error or a stage not done within cfg.build.stuckMs stops the build: fault()
 * (main.js counts it as a safety error) and status().build says which stage and why.
 * A refused message or a layer error at any time goes to fault(text).
 */
const ST = require('./stages');
const S = require('./shader');
const RD = require('./renderer');

/** The plain test steps: 2 BAR (three bars: amber plain; green 0.1.3's dead-man; blue 0.1.1's), 3 TINT, 4 IMAGE. */
const TEST_RECTS = {
    2: [{ x: 590, y: 236, w: 240, h: 44, color: [1, 0.66, 0.06, 1], alive: 'plain' }, { x: 840, y: 236, w: 240, h: 44, color: [0.2, 0.85, 0.35, 1], alive: 'new' },
        { x: 1090, y: 236, w: 240, h: 44, color: [0.15, 0.55, 1, 1], alive: 'old' }],
    3: [{ x: 0, y: 0, w: 1920, h: 720, color: [0.1, 0.45, 1, 0.3], alive: 'plain' }],
};
const CARD = { w: 256, h: 128, y: 296, xImage: 684, xAsset: 980 };
const kib = (b) => (b / 1048576).toFixed(1) + ' MiB';

/** A w x h RGBA test card: 16 px checks of colours a and b inside a 4 px white border. */
function card(w, h, a, b) {
    const px = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const c = x < 4 || y < 4 || x >= w - 4 || y >= h - 4 ? [255, 255, 255] : ((x >> 4) + (y >> 4)) % 2 ? a : b, i = (y * w + x) * 4;
            px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255;
        }
    }
    return px;
}
/** A box's whole asset: each row its coverage then its palette indices (stages.encodeBox gives the rects' layout). */
function boxWhole(px, w, h) {
    const lh = ST.encodeBox(px, w, { x: 0, y: 0, w, h }), out = Buffer.alloc(2 * w * h);
    for (let y = 0; y < h; y++) { lh.copy(out, y * 2 * w, y * w, (y + 1) * w); lh.copy(out, y * 2 * w + w, (h + y) * w, (h + y + 1) * w); }
    return out;
}

function createOutput(o) {
    const cfg = o.cfg, log = o.log, guard = o.guard, fault = o.fault || (() => {}), diag = o.diag || (() => {});
    const name = o.name || 'adam_mtrack', label = o.label || 'cover', deadman = o.deadman !== false, RC = cfg.renderer, B = cfg.build;
    const G = require('./geom');
    const allStages = o.stages || ST.coverStages(o.art || {}, cfg);
    let cr = null, link = 'none', armedUnits = null, uploaded = 0, shown = false;
    let assets = {}, layers = {}, targets = {}, layerSt = {}, lastError = null, cap = null, renderer = null, statusWhy = '', check = null, release = null;
    let wire = { blocked: 0, ticks: 0 };   // wireStats
    let mineTill = 0;                   // after our own drop the panel's state is still ours until it says lingering or idle
    let asked = 0, answered = 0, askAt = 0, freeAt = -Infinity, busyWas = '', errRefs = {};
    let run = null, lastStop = null, frame = {}, lastRearm = -Infinity, lastOld = -Infinity, flash = -1, flashAnim = 0;
    const boxes = { panelL: null, panelR: null, cornerL: null, cornerR: null }, sent = {};

    const summary = (st) => Object.keys(st.targets).filter((t) => t === 'panel' || t === 'hud').map((t) => t + ' ' + st.targets[t].state + (st.targets[t].reason ? ' (' + st.targets[t].reason + ')' : '') + (st.targets[t].rendering ? '; ' + st.targets[t].rendering : ''))
        .concat(st.layers.filter((l) => l.target === 'panel' || l.target === 'hud').map((l) => l.app + ' ' + l.kind + ' on ' + l.target + ' ' + l.state + (l.reason ? ' - ' + l.reason : ''))).join(', ');
    function finishCheck(v) {
        const c0 = check;
        check = null;
        v.ms = Date.now() - c0.at;
        const text = RD.verdictText(v, c0.why);
        if (v.ok) log.info(text); else log.warn(text);
        diag(text);
        release = Object.assign(v, { text, short: RD.verdictShort(v), why: c0.why, at: Date.now() });
    }
    function ask() { if (cr && cr.ready) { cr.status(); asked++; askAt = Date.now(); } }
    function requestStatus(why) {
        if (!cr || !cr.ready) return false;
        if (why) statusWhy = why;
        ask();
        return true;
    }
    /** We hold a layer on the panel (or did a moment ago): the panel being wanted is then us, not another app. */
    const mine = (now) => shown || Object.keys(layers).length > 0 || now < mineTill;
    /** Another app let go of the HUD or the panel (the shared scene id): the build waits cfg.build.handoverMs from now. */
    function seeTargets(now) {
        const busy = RD.busyOf(targets, mine(now));
        if (busyWas && !busy) freeAt = now;
        busyWas = busy;
        if (targets.hud && targets.hud.state === 'lingering') freeAt = now;
    }
    function onEvent(ev) {
        const now = Date.now();
        if (ev.ev === 'target') {
            const was = targets[ev.target] || {}, t = { state: ev.state, holder: ev.holder || '', reason: ev.reason || '', rendering: ev.rendering || '' };
            targets[ev.target] = t;
            const changed = was.state !== t.state || was.holder !== t.holder || was.reason !== t.reason || was.rendering !== t.rendering;
            if ((ev.target === 'panel' || ev.target === 'hud') && changed) {
                log.info('cluster-render: target ' + ev.target + ' ' + t.state + (t.holder && t.holder !== 'none' ? ' holder ' + t.holder : '') + (t.reason ? ' (' + t.reason + ')' : '') +
                    (t.rendering && t.rendering !== 'none' ? ', rendering ' + t.rendering : ''));
            }
            if (ev.target === 'panel' && (t.state === 'idle' || t.state === 'lingering')) mineTill = 0;
            if (check && !check.asked && ev.target === 'panel' && (t.state === 'idle' || t.state === 'unavailable')) { check.asked = true; requestStatus('release check'); }
            seeTargets(now);
        } else if (ev.ev === 'layer') {
            layerSt[ev.ref] = { state: ev.state, reason: ev.reason || '' };
            if (ev.state === 'error') errRefs[ev.ref] = 'layer error' + (ev.reason ? ': ' + ev.reason : '');
        } else if (ev.ev === 'budget') {
            if (cap !== ev.cap_kb_per_s) log.info('cluster-render: upload cap ' + ev.cap_kb_per_s + ' KB/s' + (ev.reason ? ' (' + ev.reason + ')' : ''));
            cap = ev.cap_kb_per_s;
        } else if (ev.ev === 'error') {
            lastError = { op: ev.op, ref: ev.ref, reason: ev.reason, at: now };
            if (ev.op !== 'drop') errRefs[ev.ref] = ev.op + ': ' + ev.reason;
        } else if (ev.ev === 'status') {
            renderer = RD.parseStatus(ev.text);
            answered++;
            if (statusWhy) log.info('cluster-render status (' + statusWhy + '): ' + summary(renderer));
            statusWhy = '';
            if (check && check.asked) finishCheck(RD.verdictOf(renderer));
            if (run) advance(now);
        }
    }

    function client() {
        const c = new o.ClusterRender(name, o.socketPath);
        link = 'connecting';
        RD.tap(c, diag, guard('cr event', (ev) => { if (cr === c) onEvent(ev); }));
        c.on('ready', guard('cr ready', () => {
            if (cr !== c) return;
            link = 'ready'; asked = 0; answered = 0;
            log.info('cluster-render: connected (' + c.backend + ', ' + c.targets + ')' + (name === 'adam_mtrack' ? '' : ' as ' + name));
            requestStatus('connected');
        }));
        c.on('disconnected', guard('cr disconnected', () => {
            if (cr !== c) return;
            link = 'connecting'; targets = {}; asked = 0; answered = 0;
            log.warn('cluster-render: connection lost, reconnecting');
        }));
        // during a build: the stage and why are kept first (stop drops its layers), then the one error is counted
        c.on('layer', guard('cr layer', (ref, state, reason) => {
            if (cr !== c || state !== 'error') return;
            const note = stageNote();
            if (note) stop('layer error' + (reason ? ': ' + reason : ''), true);
            fault('cluster-render: layer ' + ref + ' error' + (reason ? ' (' + reason + ')' : '') + note);
        }));
        c.on('refused', guard('cr refused', (op, ref, reason) => {
            if (cr !== c || op === 'drop') return;
            const note = stageNote();
            if (note) stop('refused: ' + op + ': ' + reason, true);
            fault('cluster-render refused ' + op + ' ' + ref + ': ' + reason + note);
        }));
        c.connect();
        return c;
    }
    const stageNote = () => (run && run.i < run.list.length ? ' (stage ' + (run.i + 1) + ' ' + run.list[run.i].name + ')' : '');

    function sendAsset(a) {
        if (assets[a.name]) return 0;
        const px = a.box && boxes[a.name] ? boxWhole(boxes[a.name], a.w / 2, a.h) : a.px();
        const ref = cr.asset({ target: 'panel', format: a.format, w: a.w, h: a.h, sampling: a.sampling || 'nearest' });
        if (!ref) throw new Error('cluster-render client refused asset ' + a.name);
        if (!cr.pixels(ref, null, px)) throw new Error('cluster-render client refused the pixels of ' + a.name);
        assets[a.name] = ref;
        if (a.box && boxes[a.name]) sent[a.name] = Buffer.from(boxes[a.name]);
        uploaded += px.length;
        diag('> pixels ' + a.name + ' (asset ' + ref + ', ' + a.format + ' ' + a.w + 'x' + a.h + '): ' + px.length + ' B');
        return px.length;
    }

    function arm(units) {
        const variant = units === 'metric' ? 'metric' : 'us';
        if (cr && armedUnits === variant) return false;
        if (cr) disarm('units changed');
        cr = client();
        armedUnits = variant;
        uploaded = 0;
        release = null;
        return true;
    }

    /** A live box's pixels: only the box of changed pixels since the last send goes (nothing when none). */
    function box(n, px) {
        boxes[n] = px;
        const ref = assets[n];
        if (!cr || !ref) return 0;
        const r = G.RECTS[n], w = r.w, last = sent[n];
        let x0 = w, y0 = r.h, x1 = -1, y1 = -1;
        if (!last) { x0 = 0; y0 = 0; x1 = w - 1; y1 = r.h - 1; } else {
            for (let y = 0; y < r.h; y++) {
                const row = y * w * 4;
                for (let x = 0; x < w; x++) {
                    const i = row + x * 4;
                    if (px[i] !== last[i] || px[i + 1] !== last[i + 1] || px[i + 2] !== last[i + 2] || px[i + 3] !== last[i + 3]) {
                        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
                    }
                }
            }
        }
        if (x1 < 0) return 0;
        const rect = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }, out = ST.encodeBox(px, w, rect);
        cr.pixels(ref, [rect, { x: w + rect.x, y: rect.y, w: rect.w, h: rect.h }], out);
        sent[n] = Buffer.from(px);
        return out.length;
    }

    function uni(l, n, v, opts) {
        const k = n + ':' + v.join(' ');
        if (l.u[n] === k) return;
        l.u[n] = k;
        cr.uniform(l.ref, n, v, opts);
    }

    /* ---------- the build ---------- */
    /** The build stops: which stage and why are kept for status().build; its layers dropped; one error (fault) unless counted. */
    function stop(why, counted) {
        if (!run || run.state === 'shown') return;
        const s = run.list[Math.min(run.i, run.list.length - 1)], used = run.list.filter((x) => x.on(frame));
        lastStop = { n: used.indexOf(s) + 1, of: used.length, name: s.name, why, at: Date.now() };
        const text = label + ': build stopped at stage ' + lastStop.n + ' of ' + lastStop.of + ' ' + lastStop.name + ': ' + why;
        log.warn(text);
        diag(text);
        drop('build stopped');
        if (!counted) fault('cluster-render: ' + label + ' stage ' + lastStop.n + ' ' + lastStop.name + ' ' + why);
    }
    function startStage(now) {
        const s = run.list[run.i], add = s.assets.filter((a) => !assets[a.name]);
        const need = add.reduce((b, a) => b + ST.bytesOf(a) * 2, 0), mem = RD.memoryOf(renderer, name);
        if (need && mem.all + need + RC.marginBytes > RC.pixelBytes) {
            stop('not sent: the renderer\'s pixel memory is full (' + kib(mem.all) + ' in use' + (mem.others.length ? ': ' + mem.others.join(', ') : '') + ', ' + kib(need) + ' needed)');
            return;
        }
        const bytes = add.reduce((b, a) => b + sendAsset(a), 0);
        const ref = cr.effect(Object.assign({ target: 'panel', klass: B.klass, z: s.z, exclusive: false, contend: false, visible: false, fs: s.fs }, { x: s.rect.x, y: s.rect.y, w: s.rect.w, h: s.rect.h }));
        if (!ref) throw new Error('cluster-render client refused layer ' + s.id);
        layers[s.id] = { ref, u: {}, anim: 0, stage: s, alive: deadman };
        run.state = 'confirming'; run.at = now; run.askFrom = asked + 1;
        diag(label + ': stage ' + (run.i + 1) + ' ' + s.name + ' made hidden (layer ' + ref + ', ' + add.length + ' assets, ' + bytes + ' B)');
        ask();
    }
    function lift(s, l) {
        uni(l, 'u_alive', [0]);
        cr.set(l.ref, { visible: true });
        run.state = 'writing'; run.askFrom = asked + 1;
        ask();
    }
    function bind(s, l) {
        Object.keys(s.binds).forEach((smp) => cr.bind(l.ref, smp, assets[s.binds[smp]]));
        s.statics().forEach((x) => uni(l, x[0], x[1], x[2]));
        diag(label + ': stage ' + (run.i + 1) + ' ' + s.name + ' confirmed and written: bound');
    }
    /** The status answered: the stage under way moves on when the renderer says so (only answers to asks after its last step). */
    function advance(now) {
        if (run.state === 'handover' || run.state === 'shown' || answered < run.askFrom) return;
        if (run.state === 'waiting') { begin(now); return; }
        const s = run.list[run.i], l = layers[s.id];
        const bad = Object.keys(layers).map((k) => layers[k].ref).concat(Object.keys(assets).map((k) => assets[k])).map((r) => errRefs[r]).filter(Boolean)[0];
        if (bad) { stop('refused: ' + bad, true); return; }
        if (run.state === 'confirming') { lift(s, l); return; }
        const up = RD.uploadsOf(renderer, name, 'panel'), want = Object.keys(assets).length;
        if (up.listed < want || up.unwritten) return;   // asked again on the next tick
        bind(s, l);
        run.i++;
        while (run.i < run.list.length && !run.list[run.i].on(frame)) run.i++;
        if (run.i < run.list.length) startStage(now); else showAll(now);
    }
    function begin(now) {
        if (!cr || !cr.ready || !answered) { run.state = 'waiting'; run.askFrom = 1; return; }
        if (now - freeAt < B.handoverMs && now >= freeAt) {
            if (run.state !== 'handover') log.info(label + ': waiting ' + ((B.handoverMs - (now - freeAt)) / 1000).toFixed(1) + ' s for the HUD to let go of the shared scene');
            run.state = 'handover';
            return;
        }
        run.i = 0;
        while (run.i < run.list.length && !run.list[run.i].on(frame)) run.i++;
        startStage(now);
    }
    function showAll(now) {
        const ids = run.list.filter((s) => layers[s.id]).map((s) => s.id).reverse();
        flash = -1; flashAnim = 0;
        ids.forEach((id) => {
            const l = layers[id];
            l.stage.live(frame).forEach((x) => uni(l, x[0], x[1], x[2]));
            if (l.stage.slats && frame.slats) flashOf(l, frame.slats.flashing ? 1 : 0);
            uni(l, 'u_alive', [1]);          // the client's own value while shown: drawn whether or not the KOMBI plays the animation
            if (l.alive) l.anim = cr.animate(l.ref, { property: 'uniform', name: 'u_alive', keys: cfg.safety.aliveKeys, loop: false, interp: 'linear' });
        });
        run.state = 'shown';
        shown = true; check = null; lastRearm = now; lastStop = null;
        const seen = {}, mem = run.list.reduce((b, s) => b + s.assets.reduce((x, a) => { if (seen[a.name] || !assets[a.name]) return x; seen[a.name] = true; return x + ST.bytesOf(a) * 2; }, 0), 0);
        log.info(label + ': shown (' + ids.length + ' layers, ' + Object.keys(assets).length + ' assets, ' + kib(mem) + ' of renderer memory, built in ' + (now - run.t0) + ' ms)');
        log.info('cluster-render: layers ' + ids.slice().reverse().map((id) => id + '#' + layers[id].ref).join(', '));
    }

    /** Builds and shows the stages; frame: the latest values (the build shows with them). */
    function show(f) {
        frame = f || {};
        if (!cr || shown || run) return;
        run = { list: allStages, i: 0, state: 'waiting', askFrom: 1, at: Date.now(), t0: Date.now() };
        begin(Date.now());
    }

    /** Test steps 2 to 4 (ladder.js): their own layers on this connection, made visible at once. */
    function showTest(n) {
        if (!cr || shown) return;
        const z = cfg.zBase;
        if (TEST_RECTS[n]) {
            TEST_RECTS[n].forEach((r, i) => {
                const ref = cr.effect({ target: 'panel', klass: B.klass, x: r.x, y: r.y, w: r.w, h: r.h, z: z + i, fs: S.FS_SOLID });
                if (!ref) throw new Error('cluster-render client refused the test bar');
                const l = layers['test' + n + '_' + i] = { ref, u: {}, anim: 0, alive: r.alive === 'new', old: r.alive === 'old' };
                uni(l, 'u_color', r.color);
                uni(l, 'u_alive', [r.alive === 'old' ? 0 : 1]);
                const keys = r.alive === 'old' ? cfg.test.oldAliveKeys : cfg.safety.aliveKeys;
                if (r.alive !== 'plain') l.anim = cr.animate(ref, { property: 'uniform', name: 'u_alive', keys, loop: false, interp: 'linear' });
            });
        } else if (n === 4) {
            const ref = cr.image({ target: 'panel', klass: B.klass, z, x: CARD.xImage, y: CARD.y, w: CARD.w, h: CARD.h });
            if (!ref) throw new Error('cluster-render client refused the test image layer');
            layers.test4_image = { ref, u: {}, anim: 0 };
            const px = card(CARD.w, CARD.h, [40, 110, 255], [230, 236, 255]);
            cr.pixels(ref, null, px);
            uploaded += px.length;
            diag('> pixels test card (image ' + ref + ', rgba8 ' + CARD.w + 'x' + CARD.h + '): ' + px.length + ' B');
            sendAsset({ name: 'card', format: 'rgba8', w: CARD.w, h: CARD.h, px: () => card(CARD.w, CARD.h, [255, 140, 20], [255, 236, 214]) });
            const e = cr.effect({ target: 'panel', klass: B.klass, z: z + 1, x: CARD.xAsset, y: CARD.y, w: CARD.w, h: CARD.h, fs: S.FS_TEX });
            if (!e) throw new Error('cluster-render client refused the test effect layer');
            const l = layers.test4_asset = { ref: e, u: {}, anim: 0 };
            cr.bind(e, 'u_tex', assets.card);
            uni(l, 'u_tint', [1, 1, 1, 1]); uni(l, 'u_bright', [1]); uni(l, 'u_alive', [1]);
        } else return;
        shown = true; check = null; lastRearm = Date.now(); lastOld = Date.now();
        log.info('cluster-render: layers ' + Object.keys(layers).map((k) => k + '#' + layers[k].ref).join(', '));
    }

    function update(f) {
        frame = f || {};
        if (!cr || !shown || !run) return;
        run.list.forEach((s) => {
            const l = layers[s.id];
            if (!l) return;
            s.live(frame).forEach((x) => uni(l, x[0], x[1], x[2]));
            if (s.slats && frame.slats) flashOf(l, frame.slats.flashing ? 1 : 0);
        });
    }
    function flashOf(sl, fl) {
        if (fl === flash) return;
        flash = fl;
        if (flashAnim) { cr.stop(sl.ref, flashAnim); flashAnim = 0; }
        if (fl) { const half = Math.round(500 / cfg.flashHz); flashAnim = cr.animate(sl.ref, { property: 'uniform', name: 'u_on', keys: '0:1 ' + half + ':0 ' + (2 * half) + ':1', loop: true, interp: 'step' }); }
    }

    /** The dead-man: a NEW animation holding u_alive first, then the previous one stopped (never a moment with none). */
    function rearm(l) {
        const a = cr.animate(l.ref, { property: 'uniform', name: 'u_alive', keys: cfg.safety.aliveKeys, loop: false, interp: 'linear' });
        if (!a) return;
        const old = l.anim;
        l.anim = a;
        if (old && old !== a) cr.stop(l.ref, old);
    }
    /** Step 2's blue bar: exactly 0.1.1's dead-man, the same animation number sent again (the pinned client has no "again"). */
    const restartOld = (l) => cr._send({ op: 'animate', ref: l.ref, anim: l.anim, property: 'uniform', name: 'u_alive', keys: cfg.test.oldAliveKeys, loop: 0, interp: 'linear' });
    function pump(now) {
        if (cr) { wire.ticks++; if (cr.blocked) wire.blocked++; }   // the socket's backlog, for the 30 s log line (read only)
        if (!cr || !shown) return false;
        let did = false;
        // a backward clock jump re-arms at once (KB-ANY-204)
        if (now < lastRearm || now - lastRearm >= cfg.safety.aliveRearmMs) {
            lastRearm = now;
            Object.keys(layers).forEach((k) => { if (layers[k].alive) { rearm(layers[k]); did = true; } });
        }
        if (now < lastOld || now - lastOld >= cfg.test.oldAliveResendMs) {
            lastOld = now;
            Object.keys(layers).forEach((k) => { if (layers[k].old) restartOld(layers[k]); });
        }
        return did;
    }

    function tick(now) {
        if (check && !check.asked && (now - check.at >= RC.verifyMs || now < check.at)) { check.asked = true; check.at2 = now; requestStatus('release check after ' + RC.verifyMs / 1000 + ' s'); }
        if (check && check.asked && check.at2 && now - check.at2 >= 2000) finishCheck({ ok: false, ours: 0, panel: 'no status reply', others: [] });
        if (run && !shown) {
            if (run.state === 'handover' || run.state === 'waiting') begin(now);
            else if (now - run.at >= B.stuckMs || now < run.at) {
                const l = layers[run.list[run.i].id], up = RD.uploadsOf(renderer, name, 'panel'), p = targets.panel || {};
                stop((run.state === 'confirming' ? 'not confirmed by the renderer' : 'its art not written (' + up.unwritten + ' of ' + up.listed + ' assets unwritten, ' + up.failed + ' failed writes)') +
                    ' after ' + B.stuckMs / 1000 + ' s; panel ' + (p.state || 'unknown') + (l && layerSt[l.ref] ? ', layer ' + layerSt[l.ref].state + (layerSt[l.ref].reason ? ' - ' + layerSt[l.ref].reason : '') : ''));
            } else if (now - askAt >= B.askMs || now < askAt) ask();
        }
        return pump(now);
    }

    function drop(why) {
        const keys = Object.keys(layers);          // the stages in build order: the opaque tachs goes first
        if (cr) keys.forEach((k) => cr.drop(layers[k].ref));
        layers = {};
        flashAnim = 0;
        const had = keys.length > 0;
        if (shown) log.info(label + ': dropped (' + why + ')');
        else if (run && keys.length && why !== 'build stopped') log.info(label + ': build dropped at stage ' + (run.i + 1) + ' (' + why + ')');
        shown = false;
        run = null; errRefs = {};
        if (cr && keys.length && had) { check = { why, at: Date.now(), asked: false }; mineTill = Date.now() + RC.lingerMs + 6000; }
    }

    function disarm(why) {
        const was = !!cr;
        drop(why);
        check = null;                       // the connection goes with it: main.js checks this release with a watcher
        if (cr) { cr.close(); log.info('cluster-render: closed (' + why + ')' + (name === 'adam_mtrack' ? '' : ' as ' + name)); }
        cr = null; link = 'none'; armedUnits = null; assets = {}; targets = {}; layerSt = {}; renderer = null; mineTill = 0; asked = 0; answered = 0;
        Object.keys(sent).forEach((n) => { sent[n] = null; });
        return was;
    }

    function layerCounts() {
        const out = {};
        Object.keys(layers).forEach((n) => { const s = layerSt[layers[n].ref], k = s ? s.state + (s.reason ? ' (' + s.reason + ')' : '') : 'sent'; out[k] = (out[k] || 0) + 1; });
        return out;
    }
    const STATE_WORD = { waiting: 'waiting for the renderer', handover: 'waiting for the HUD to let go of the shared scene', confirming: 'waiting for the renderer to confirm its layer',
        writing: 'waiting for the renderer to write its art', shown: 'shown' };
    function buildStatus() {
        const used = allStages.filter((s) => s.on(frame));
        if (run) {
            const s = run.list[Math.min(run.i, run.list.length - 1)], n = run.state === 'shown' ? used.length : used.indexOf(s) + 1;
            return { state: run.state, n, of: used.length, name: run.state === 'shown' ? '' : s.name, word: STATE_WORD[run.state], why: '', stop: lastStop };
        }
        return { state: lastStop ? 'stopped' : 'idle', n: lastStop ? lastStop.n : 0, of: used.length, name: lastStop ? lastStop.name : '', word: lastStop ? 'stopped' : 'not built', why: lastStop ? lastStop.why : '', stop: lastStop };
    }

    return {
        arm, disarm, show, showTest, update, drop, tick, pump, box, requestStatus,
        /** Pump ticks since the last call, and how many found the socket blocked (its write buffer full); then resets. */
        wireStats: () => { const w = wire; wire = { blocked: 0, ticks: 0 }; return w; },
        status: () => {
            const p = targets.panel || {};
            return {
                link, armed: !!cr, units: armedUnits, shown, target: p.state || null, holder: p.holder || null, reason: p.reason || '', rendering: p.rendering || '',
                uploaded, targets, cap, lastError, layers: layerCounts(), busy: cr ? RD.busyOf(targets, mine(Date.now())) : '', warm: RD.warmOf(renderer),
                others: RD.othersOn(renderer, ['panel', 'hud']), release, renderer, build: buildStatus(),
            };
        },
    };
}

module.exports = { createOutput, TEST_RECTS, CARD, boxWhole };
