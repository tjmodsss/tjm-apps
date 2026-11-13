'use strict';
/**
 * ladder.js - the staged test pattern on the Safety page: six steps, each proving one part of the cover's path on the
 * car, parked. Each step is its own cluster-render client (adam_mtrack-test), refuses while the cover is on, the car is
 * not parked or another app holds the cluster scene, shows for cfg.test.stepMs (10 s) once drawn and removes itself,
 * logs what cluster-render says (target and layer states, errors, its status, the stage a build reached) and shows it;
 * after it a watcher (renderer.verifyRelease) confirms the panel is idle again, the stock cluster back.
 *
 *   1 KNOWN  G's Dash's full-screen cluster test, in M Track's own code: one effect layer over the whole panel, one r8
 *            1024 x 576 asset, made hidden, confirmed by the status, lifted, written, then shown with its dead-man held
 *            at 1. It drew on Adam's car in G's Dash and in 0.1.3 (2026-11-05): both round dials are ours, the layer is
 *            the whole panel; 0.1.4 adds a frame and an edge ruler so a photo shows where the glass clips it
 *   2 BAR    three bars, no asset: amber u_alive 1 (no animation); green 0.1.3's dead-man (value 1, re-armed); blue
 *            exactly 0.1.1's (value 0, the same animation number sent again). Blue missing = the 0.1.1 fault
 *   3 TINT   one translucent blue 1920 x 720 effect: a whole-panel layer
 *   4 IMAGE  a 256 x 128 test card as an image layer (left, blue) and as an asset sampled by an effect (right, orange)
 *   5 TACHS  the cover's stage 1 alone (its opaque tachs layer), built and confirmed as the cover builds it
 *   6 COVER  the whole cover, every stage built and confirmed in order, then shown with the dead-man held
 *
 *   const lad = createLadder({ cfg, log, diag, makeOutput(opts), verify(why, done), frame(), drawBoxes(out), units(),
 *                              changed(), knownCard() })
 *   lad.start(n, { armed, parked }) -> '' when started, else why not;  lad.stop(why);  lad.tick(now, { parked })
 *   lad.running();  lad.status() -> null | { n, name, running, state, line (the Safety row), lines (the Safety block, 5) }
 */
const ST = require('./stages');

const STEPS = {
    1: { name: 'KNOWN', what: 'the whole panel: our two dials, the card, an edge ruler', build: 'known' },
    2: { name: 'BAR', what: 'amber = panel path, green = 0.1.3 dead-man, blue = 0.1.1 dead-man' },
    3: { name: 'TINT', what: 'a blue tint over the whole cluster' },
    4: { name: 'IMAGE', what: 'left: image layer, right: asset and shader' },
    5: { name: 'TACHS', what: 'the cover\'s stage 1, its tachs layer', build: 'tachs' },
    6: { name: 'COVER', what: 'the whole cover, every stage confirmed', build: 'cover' },
};

const kb = (b) => (b >= 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.round(b / 1e3) + ' KB');
const tgt = (t) => (t ? t.state + (t.holder && t.holder !== 'none' && t.holder !== 'us' ? ' (' + t.holder + ')' : '') + (t.reason ? ' (' + t.reason + ')' : '') +
    (t.rendering && t.rendering !== 'none' ? ', ' + t.rendering : '') : 'no answer');
/** A build's progress in one phrase: 'stage 2 of 4 PANELS: waiting for ...', 'stopped at stage 1 KNOWN: why', '1 of 1 stages'. */
function buildWord(b) {
    if (!b) return '';
    if (b.state === 'shown') return 'all ' + b.of + ' stage' + (b.of > 1 ? 's' : '') + ' confirmed and shown';
    if (b.state === 'stopped') return 'stopped at stage ' + b.n + ' of ' + b.of + ' ' + b.name + ': ' + b.why;
    if (b.state === 'idle') return '';
    return 'stage ' + b.n + ' of ' + b.of + ' ' + b.name + ': ' + b.word;
}

function createLadder(o) {
    const T = o.cfg.test, log = o.log, diag = o.diag || (() => {});
    let run = null, last = null, seq = 0;
    const left = (now) => Math.max(0, Math.ceil((T.stepMs - (now - run.shownAt)) / 1000));

    function note(text) { log.info('test: ' + text); diag('test: ' + text); }
    function snapshot(r) {
        const st = r.out.status();
        return { panel: st.targets.panel, hud: st.targets.hud, layers: st.layers, lastError: st.lastError, cap: st.cap, warm: st.warm, others: st.others, uploaded: st.uploaded, build: STEPS[r.n].build ? st.build : null };
    }
    function refuse(n, why) {
        last = { n, state: 'refused', why, at: Date.now(), id: ++seq };
        note('step ' + n + ' ' + STEPS[n].name + ' refused: ' + why);
        o.changed();
        return why;
    }
    function stagesOf(kind) {
        if (kind === 'known') return ST.knownStages(o.knownCard, o.cfg);
        const all = ST.coverStages(o.art || {}, o.cfg);
        return kind === 'tachs' ? all.slice(0, 1) : all;
    }

    function start(n, ctx) {
        const s = STEPS[n];
        if (!s) return 'no such step';
        if (ctx.armed) return refuse(n, 'turn Cover the cluster off first');
        if (!ctx.parked) return refuse(n, 'parked only (in P or barely moving)');
        if (run) stop('replaced by step ' + n, true);
        const out = o.makeOutput(Object.assign({ name: 'adam_mtrack-test', label: 'test' }, s.build ? { stages: stagesOf(s.build) } : {}));
        out.arm(o.units());
        if (s.build === 'cover') o.drawBoxes(out);
        run = { n, out, t0: Date.now(), state: 'connecting', readyAt: null, shownAt: null, asked: false, left: -1 };
        last = null;
        note('step ' + n + ' ' + s.name + ': ' + s.what + ', connecting');
        o.changed();
        return '';
    }

    function stop(why, replaced, refusal) {
        if (!run) { if (why === 'stop button' && last) { last = null; o.changed(); } return; }
        const r = run, drew = r.state === 'showing' || r.state === 'building';
        run = null;
        const snap = snapshot(r);
        r.out.disarm('test step ' + r.n + ': ' + (refusal ? 'refused' : why));
        const id = ++seq;
        const stopped = !refusal && snap.build && snap.build.state === 'stopped';
        last = Object.assign(snap, { n: r.n, state: refusal ? 'refused' : stopped ? 'stopped' : 'done', why: refusal || why, at: Date.now(), id, release: null });
        note('step ' + r.n + ' ' + STEPS[r.n].name + (refusal ? ' refused: ' + refusal : ': ' + why) + '; panel ' + tgt(snap.panel) + '; layers ' +
            (Object.keys(snap.layers).map((k) => snap.layers[k] + ' ' + k).join(', ') || 'none') + (snap.build ? '; build ' + buildWord(snap.build) : '') +
            (snap.lastError ? '; last error ' + snap.lastError.op + ': ' + snap.lastError.reason : ''));
        if (drew && !replaced) {
            last.release = { pending: true };
            o.verify('test step ' + r.n, (v) => { if (last && last.id === id) { last.release = v; o.changed(); } });
        }
        o.changed();
    }

    /** The service reported the targets and answered the status asked at connect: refuse for another app, else start drawing. */
    function begin(r, st, now) {
        if (st.busy) { stop('refused', false, 'another app is using the cluster (' + (st.others.length ? st.others.join(', ') : st.busy) + ')'); return; }
        const s = STEPS[r.n];
        if (s.build) {
            r.out.show(o.frame());
            r.state = 'building';
            note('step ' + r.n + ' ' + s.name + ': building, each stage confirmed by cluster-render' + (st.warm ? '; the HUD\'s scene was still published, so the panel swaps the shared scene id' : ''));
        } else {
            r.out.showTest(r.n);
            shownNow(r, now, st);
        }
        o.changed();
    }
    function shownNow(r, now, st) {
        r.state = 'showing';
        r.shownAt = now;
        note('step ' + r.n + ' ' + STEPS[r.n].name + ': showing for ' + T.stepMs / 1000 + ' s' + (!STEPS[r.n].build && st.warm ? '; the HUD\'s scene was still published, so the panel swaps the shared scene id' : ''));
    }

    function tick(now, ctx) {
        if (!run) return;
        const r = run, st = r.out.status();
        if (r.state === 'connecting') {
            if (st.link === 'ready' && r.readyAt === null) r.readyAt = now;
            // decide once the service has reported the targets and answered the status asked at connect (names the apps)
            if (r.readyAt !== null && ((st.targets.panel && st.renderer) || now - r.readyAt >= 600)) begin(r, st, now);
            else if (now - r.t0 >= T.connectMs || now < r.t0) stop('cluster-render did not answer');
            return;
        }
        r.out.tick(now);
        if (!ctx.parked) { stop('stopped: the car moved'); return; }
        if (r.state === 'building') {
            const b = st.build;
            if (b.state === 'stopped') { stop('build ' + buildWord(b)); return; }
            if (b.state === 'shown') { shownNow(r, now, st); o.changed(); } else { r.out.show(o.frame()); if (b.n !== r.stage) { r.stage = b.n; o.changed(); } return; }
        }
        if (STEPS[r.n].build) r.out.update(o.frame());
        if (!r.asked && now - r.shownAt >= T.statusAfterMs) { r.asked = true; r.out.requestStatus('test step ' + r.n); }
        if (now - r.shownAt >= T.stepMs || now < r.shownAt) { stop('removed after ' + T.stepMs / 1000 + ' s'); return; }
        const l = left(now);
        if (l !== r.left) { r.left = l; o.changed(); }
    }
    /** The dead-man re-arm of a running step (main.js calls it with the cover's pump). */
    function pump(now) { if (run && run.state !== 'connecting') run.out.pump(now); }

    function status() {
        if (!run && !last) return null;
        const now = Date.now(), n = run ? run.n : last.n, s = STEPS[n], d = run ? snapshot(run) : last, head = 'Step ' + n + ' ' + s.name;
        let state, line;
        if (run && run.state === 'connecting') { state = 'connecting to cluster-render'; line = head + ': connecting to cluster-render'; }
        else if (run && run.state === 'building') { state = 'building: ' + buildWord(d.build); line = head + ' building: ' + buildWord(d.build); }
        else if (run) { state = 'showing, ' + left(now) + ' s left: ' + s.what; line = head + ' showing: ' + left(now) + ' s left. Watch the cluster'; }
        else if (last.state === 'refused') { state = 'refused: ' + last.why; line = head + ' refused: ' + last.why.replace(/ \(.*\)$/, ''); }
        else if (last.state === 'stopped') { state = buildWord(last.build); line = head + ' ' + buildWord(last.build); }
        else {
            const rel = last.release;
            state = last.why;
            line = head + ' done: ' + (!rel ? last.why : rel.pending ? 'checking the release' : rel.ok || rel.unreachable ? 'released' : 'release NOT confirmed');
        }
        const lay = Object.keys(d.layers || {}).map((k) => d.layers[k] + ' ' + k).join(', ');
        const rel = run ? 'Release: checked after the step' : !last.release ? 'Release: not checked (nothing was drawn)'
            : last.release.pending ? 'Release: checking (the panel must go idle)' : last.release.short;
        const r0 = !run && last.release && !last.release.pending ? last.release : null;
        return {
            n, name: s.name, running: !!run, state: run ? run.state : last.state, line, released: r0 ? !!(r0.ok || r0.unreachable) : null, build: d.build || null,
            lines: [
                head + ': ' + state,
                'Panel: ' + tgt(d.panel) + '; HUD: ' + tgt(d.hud),
                'Layers: ' + (lay || 'none') + (d.uploaded ? '; uploaded ' + kb(d.uploaded) : '') + (d.build && d.build.state !== 'idle' ? '; build ' + d.build.n + ' of ' + d.build.of : ''),
                'Renderer: ' + (d.lastError ? 'error ' + d.lastError.op + ': ' + d.lastError.reason : 'no error') + (d.cap ? '; cap ' + d.cap + ' KB/s' : '') +
                    (d.warm ? '; HUD scene was published' : '') + (d.others && d.others.length ? '; ' + d.others.join(', ') : ''),
                rel,
            ],
        };
    }

    return { start, stop, tick, pump, status, running: () => !!run, STEPS };
}

module.exports = { createLadder, STEPS, buildWord };
