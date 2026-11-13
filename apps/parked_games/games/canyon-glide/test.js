'use strict';
// Canyon Glide tests: node apps/parked_games/games/canyon-glide/test.js
const assert = require('assert');
const CG = require('./index');
const { Cave, H, gapAt } = require('./cave');
const { Round, READY_S, CRASH_S, PX_PER_M } = require('./game');
const { Input, KNOB_STEP, HOLD_SPAN } = require('./input');
const { pilot } = require('./autopilot');

let n = 0;
function test(name, fn) { fn(); n++; console.log('ok ' + n + ' - ' + name); }
const FRAME = 1000 / 60;
function run(r, seconds, inputFn) { for (let i = 0; i < seconds * 60; i++) r.update(FRAME, inputFn ? inputFn(r, i) : {}); return r; }
const auto = (r) => ({ steer: -pilot(r) });          // autopilot as a wheel (clockwise = dive)
const round = (o) => new Round(Object.assign({ seed: 1 }, o));

/** a stand-in for the shell's api (GAMES.md) */
function fakeApi(o) {
    o = o || {};
    const api = {
        W: 1600, H: 520, now: () => 0, random: () => 0.5, ended: [], logs: [],
        log: { info: (m) => api.logs.push(m), warn() {}, error() {} },
        theme: () => ({ accent2: '#81c4ff' }), best: () => (o.best === undefined ? null : o.best), top: () => [],
        end: (s) => api.ended.push(s),
        store: { v: {}, get: (k) => api.store.v[k], set: (k, v) => { api.store.v[k] = v; } },
    };
    return api;
}

/** a recorder double that only has the calls GAMES.md lists, and checks their numbers */
function fakeCanvas(calls) {
    const ok = ['fillRect', 'roundRect', 'strokeRoundRect', 'gradientRect', 'circle', 'arc', 'line', 'polyline', 'quad', 'text', 'textWidth', 'alpha', 'clip', 'noclip'];
    const num = (k, v) => { if (typeof v === 'number') assert.ok(isFinite(v), k + ' got ' + v); else if (Array.isArray(v)) v.forEach((x) => num(k, x)); };
    return new Proxy({}, { get: (o, k) => {
        assert.ok(ok.indexOf(k) >= 0, 'draws with ' + String(k) + ', not in GAMES.md');
        return function () { calls[k] = (calls[k] || 0) + 1; for (const a of arguments) num(k, a); return 0; };
    } });
}

test('module has the GAMES.md shape', () => {
    assert.strictEqual(CG.id, 'canyon-glide');
    assert.ok(CG.title.length <= 18 && CG.blurb.length <= 40);
    assert.deepStrictEqual(CG.needs, []);
    assert.strictEqual(CG.score.lower, false);
    const g = CG.create(fakeApi());
    ['update', 'draw', 'input'].forEach((f) => assert.strictEqual(typeof g[f], 'function'));
});

test('same seed, same cave', () => {
    const a = new Cave(42), b = new Cave(42), c = new Cave(43);
    a.window(0, 20000); b.window(0, 20000); c.window(0, 20000);
    for (let x = 0; x < 20000; x += 333) assert.deepStrictEqual(a.at(x), b.at(x));
    assert.notDeepStrictEqual(a.at(9000), c.at(9000));
});

test('the cave stays on screen and open', () => {
    for (let seed = 1; seed <= 20; seed++) {
        const cave = new Cave(seed);
        for (let x = 0; x < 250000; x += 40) {
            cave.window(Math.max(0, x - 2000), x + 1600);
            const s = cave.at(x);
            assert.ok(s.ceil >= 10 && s.floor <= H - 10, 'seed ' + seed + ' x ' + x + ' on screen');
            assert.ok(s.floor - s.ceil >= gapAt(1) * 2 - 20, 'seed ' + seed + ' x ' + x + ' gap ' + (s.floor - s.ceil));
        }
    }
});

test('countdown, then play', () => {
    const r = round();
    assert.strictEqual(r.state, 'ready');
    run(r, READY_S - 0.1);
    assert.strictEqual(r.state, 'ready'); assert.strictEqual(r.dist, 0);
    run(r, 0.2);
    assert.strictEqual(r.state, 'play');
});

test('knob clockwise dives, anticlockwise climbs; invert swaps', () => {
    const turn = (n) => (r, i) => ({ knob: i === 0 ? n : 0 });
    const dive = run(round(), READY_S + 0.3, turn(7));
    const climb = run(round(), READY_S + 0.3, turn(-7));
    assert.ok(dive.y > H / 2 + 20, 'dive y ' + dive.y);
    assert.ok(climb.y < H / 2 - 20, 'climb y ' + climb.y);
    const inv = run(round({ invert: true }), READY_S + 0.3, turn(7));
    assert.ok(inv.y < H / 2 - 20, 'inverted y ' + inv.y);
});

test('the knob trim holds until turned back or pressed; it stops at full pitch', () => {
    const i = new Input();
    const p1 = i.update(0.016, { knob: -2 }, 260).pitch;
    assert.ok(Math.abs(p1 - 2 * KNOB_STEP) < 1e-9, 'anticlockwise = climb ' + p1);
    let p = 0; for (let k = 0; k < 120; k++) p = i.update(0.016, {}, 260).pitch;
    assert.ok(Math.abs(p - p1) < 1e-9, 'held');
    assert.ok(Math.abs(i.update(0.016, { knob: 2 }, 260).pitch) < 1e-9, 'turned back');
    assert.strictEqual(i.update(0.016, { knob: 40 }, 260).pitch, -1);
    assert.strictEqual(i.update(0.016, { level: true }, 260).pitch, 0);
});

test('taps above / below the glider nudge it up / down', () => {
    const i = new Input();
    assert.ok(i.update(0.016, { tap: { x: 400, y: 100 } }, 260).pitch > 0);
    i.reset();
    assert.ok(i.update(0.016, { tap: { x: 400, y: 450 } }, 260).pitch < 0);
});

test('holding boost speeds up and drains energy', () => {
    const a = run(round({ seed: 3 }), READY_S + 2, auto);
    const b = run(round({ seed: 3 }), READY_S + 2, (r) => Object.assign(auto(r), { boost: 1 }));
    assert.ok(b.dist > a.dist * 1.3, 'boosted ' + b.dist + ' vs ' + a.dist);
    assert.ok(b.energy < 0.8 && a.energy === 1, 'energy ' + b.energy);
    assert.ok(b.score() > a.score());
});

test('diving into the floor crashes, then the round is over', () => {
    const r = round({ best: 3 });
    run(r, READY_S + 3, () => ({ steer: 1 }));
    assert.ok(r.state === 'crash' || r.state === 'over');
    run(r, CRASH_S + 0.1);
    assert.strictEqual(r.over(), true);
    assert.strictEqual(r.best, Math.max(3, r.score()));
    const s = r.score(); run(r, 1, () => ({ steer: -1, boost: 1 }));
    assert.strictEqual(r.score(), s, 'nothing changes after the round');
});

test('every cave can be flown (autopilot survives 3 minutes on 25 seeds)', () => {
    for (let seed = 1; seed <= 25; seed++) {
        const r = run(round({ seed: seed }), READY_S + 180, auto);
        assert.strictEqual(r.state, 'play', 'seed ' + seed + ' crashed at ' + r.metres() + ' m');
    }
});

test('points: one per metre, 25 per crystal', () => {
    const r = run(round({ seed: 7 }), READY_S + 30, auto);
    const m = r.dist / PX_PER_M;
    assert.ok(r.crystals > 0, 'took a crystal');
    assert.ok(Math.abs(r.score() - (m + r.crystals * 25)) <= 2, r.score() + ' vs ' + m + ' + ' + r.crystals + ' crystals');
});

test('through the api: knob clicks dive the glider into the floor, api.end once with the score', () => {
    const api = fakeApi();
    const g = CG.create(api);
    g.input({ type: 'knob', delta: 9 });
    for (let i = 0; i < (READY_S + 6) * 60; i++) g.update(FRAME);
    assert.deepStrictEqual(api.ended, [g.round.score()]);
    for (let i = 0; i < 60; i++) g.update(FRAME);
    assert.strictEqual(api.ended.length, 1);
});

test('through the api: press levels out, push up holds the boost until released', () => {
    const g = CG.create(fakeApi());
    g.input({ type: 'knob', delta: -3 }); g.input({ type: 'press' });
    let f = g.frame();
    assert.ok(f.knob === -3 && f.level === true && f.boost === 0);
    g.input({ type: 'push', dir: 'N' });
    assert.strictEqual(g.frame().boost, 1); assert.strictEqual(g.frame().boost, 1);
    g.input({ type: 'release' });
    f = g.frame();
    assert.ok(f.boost === 0 && f.knob === 0 && f.level === false);
});

test('through the api: invert comes from the store; best from api.best()', () => {
    const api = fakeApi({ best: 1234 }); api.store.set('invert', true);
    const g = CG.create(api);
    assert.strictEqual(g.round.best, 1234);
    assert.strictEqual(g.round.input.invert, true);
});

test('draw uses only GAMES.md calls, with finite numbers, in every state', () => {
    const calls = {}, cv = fakeCanvas(calls);
    {
        const api = fakeApi();
        const g = CG.create(api);
        g.draw(cv);
        for (let i = 0; i < (READY_S + 5) * 60; i++) g.update(FRAME);
        g.draw(cv);
        g.input({ type: 'knob', delta: 12 }); for (let i = 0; i < 6 * 60; i++) g.update(FRAME);
        g.draw(cv);
        assert.ok(g.round.over());
    }
    assert.ok(calls.quad && calls.text && calls.gradientRect);
});

test('touch: a finger held above / below the glider climbs / dives towards it', () => {
    const inp = new Input();
    assert.ok(inp.update(0.016, { hold: 100 }, 260).pitch > 0.99, 'far above: full climb');
    assert.ok(inp.update(0.016, { hold: 400 }, 260).pitch < -0.99, 'far below: full dive');
    assert.ok(Math.abs(inp.update(0.016, { hold: 260 + HOLD_SPAN / 2 }, 260).pitch + 0.5) < 1e-9, 'half way: half');
    assert.strictEqual(inp.update(0.016, {}, 260).pitch, 0, 'let go: level');
});

test('touch: the Boost meter boosts while held; a finger on the cave steers', () => {
    const g = CG.create(fakeApi());
    g.input({ type: 'touch', phase: 'down', x: 1450, y: 80 });
    let f = g.frame();
    assert.strictEqual(f.boost, 1); assert.strictEqual(f.hold, null);
    g.input({ type: 'touch', phase: 'up', x: 1450, y: 80 });
    g.input({ type: 'touch', phase: 'down', x: 600, y: 150 });
    f = g.frame();
    assert.strictEqual(f.boost, 0); assert.strictEqual(f.hold, 150);
    g.input({ type: 'touch', phase: 'up', x: 600, y: 150 });
    assert.strictEqual(g.frame().hold, null);
});

console.log('all ' + n + ' passed');
