'use strict';
/** node apps/parked_games/games/sketchpad/test.js */
const assert = require('assert');
const path = require('path');
const { Pad, simplify, MAX_POINTS, ERASER } = require('./pad');
const mod = require('./index');

let failed = 0;
function test(name, fn) {
    try { fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + (e.stack || e).split('\n').slice(0, 3).join('\n     ')); }
}
const R = { x: 260, y: 52, w: 1324, h: 452 };

test('simplify keeps the ends and drops points on a straight line', () => {
    const p = []; for (let i = 0; i <= 50; i++) p.push(300 + i * 4, 200);
    assert.deepStrictEqual(simplify(p, 1.2), [300, 200, 500, 200]);
    const v = [0, 0, 50, 50, 100, 0];
    assert.deepStrictEqual(simplify(v, 1.2), v);
});
test('a stroke: begin, add (close points skipped, clamped to the paper), end', () => {
    const pad = new Pad(R);
    pad.begin(300, 100, 2, 1);
    assert.strictEqual(pad.add(301, 101), false);
    assert.strictEqual(pad.add(320, 140), true);
    pad.add(5000, -50);
    assert.ok(pad.end());
    const p = pad.strokes[0].p;
    assert.deepStrictEqual(p.slice(-2), [R.x + R.w, R.y]);
    assert.strictEqual(pad.points, p.length / 2);
});
test('undo takes back strokes, then nothing', () => {
    const pad = new Pad(R);
    pad.begin(300, 100, 0, 0); pad.add(400, 100); pad.end();
    pad.begin(300, 200, 1, 0); pad.end();
    assert.strictEqual(pad.undo(), 'stroke');
    assert.strictEqual(pad.strokes.length, 1);
    assert.strictEqual(pad.undo(), 'stroke');
    assert.strictEqual(pad.undo(), null);
    assert.strictEqual(pad.points, 0);
});
test('clear, then undo brings the page back, and its strokes undo one by one', () => {
    const pad = new Pad(R);
    for (let i = 0; i < 3; i++) { pad.begin(300 + i * 50, 100, i, 0); pad.add(300 + i * 50, 300); pad.end(); }
    assert.ok(pad.clear());
    assert.ok(pad.empty());
    assert.strictEqual(pad.clear(), false, 'an empty page does not clear');
    assert.strictEqual(pad.undo(), 'clear');
    assert.strictEqual(pad.strokes.length, 3);
    assert.strictEqual(pad.points, 6);
    assert.strictEqual(pad.undo(), 'stroke');
    assert.strictEqual(pad.strokes.length, 2);
});
test('the page holds at most MAX_POINTS points', () => {
    const pad = new Pad(R);
    let ok = true;
    for (let s = 0; s < 400 && ok; s++) {
        ok = pad.begin(300, 60, 0, 0);
        for (let i = 0; i < 40; i++) pad.add(300 + (i % 2) * 600, 60 + i * 10);   // zig-zag: nothing to simplify
        pad.end();
    }
    assert.ok(pad.points <= MAX_POINTS);
    assert.ok(pad.full);
    assert.strictEqual(pad.begin(400, 400, 0, 0), false);
});
test('save / load round trip, and bad saved values are ignored', () => {
    const pad = new Pad(R);
    pad.begin(300, 100, ERASER, 2); pad.add(500, 300); pad.end();
    const back = Pad.load(JSON.parse(JSON.stringify(pad.save())), R);
    assert.deepStrictEqual(back.strokes, pad.strokes);
    assert.strictEqual(back.undo(), 'stroke');
    assert.ok(Pad.load(null, R).empty());
    assert.ok(Pad.load({ v: 1, k: [[99, 0, [1, 2]], [0, 0, [1]], 'x'] }, R).empty());
});

/* ---------- the game with a fake api ---------- */
function api() {
    const saved = {};
    const cv = new Proxy({}, { get: (o, k) => (k === 'textWidth' || k === 'text' ? () => 50 : () => cv) });
    return {
        saved, cv,
        api: { W: 1600, H: 520, now: () => 0, random: Math.random, log: { info() {}, warn() {}, error() {} }, theme: () => ({}),
            style: require(path.join(__dirname, '..', '..', 'style')), best: () => null, top: () => [], end() { throw new Error('the sketchpad never ends'); },
            store: { get: (k) => saved[k], set: (k, v) => { saved[k] = JSON.parse(JSON.stringify(v)); } } },
    };
}
test('a finger draws on the paper; the page is saved and comes back next round', () => {
    const f = api(), g = mod.create(f.api);
    g.input({ type: 'touch', phase: 'down', x: 400, y: 200 });
    g.input({ type: 'touch', phase: 'move', x: 500, y: 260 });
    g.input({ type: 'touch', phase: 'up', x: 600, y: 300 });
    g.input({ type: 'tap', x: 600, y: 300 });
    assert.strictEqual(g.pad.strokes.length, 1);
    g.update(16); g.draw(f.cv);
    assert.strictEqual(f.saved.page.k.length, 1);
    const g2 = mod.create(f.api);
    assert.strictEqual(g2.pad.strokes.length, 1);
});
test('tapping tools: colour, size, undo, clear asks first', () => {
    const f = api(), g = mod.create(f.api);
    g.input({ type: 'touch', phase: 'down', x: 20, y: 60 }); g.input({ type: 'touch', phase: 'up', x: 20, y: 60 });
    assert.strictEqual(g.colour, 0);
    g.input({ type: 'touch', phase: 'down', x: 220, y: 400 });
    assert.strictEqual(g.size, 2);
    g.input({ type: 'touch', phase: 'down', x: 400, y: 200 }); g.input({ type: 'touch', phase: 'up', x: 700, y: 200 });
    const tap = (x, y) => { g.input({ type: 'touch', phase: 'down', x, y }); g.input({ type: 'touch', phase: 'up', x, y }); };
    tap(200, 470);                     // Clear: asks
    assert.strictEqual(g.pad.strokes.length, 1);
    tap(200, 470);                     // Sure: cleared
    assert.ok(g.pad.empty());
    tap(40, 470);                      // Undo: back
    assert.strictEqual(g.pad.strokes.length, 1);
    for (let t = 0; t < 3000; t += 16) g.update(16);
    tap(200, 470);                     // the question timed out: asks again
    assert.strictEqual(g.pad.strokes.length, 1);
});
test('the knob alone: pick a colour, go to the paper, draw a line, come back', () => {
    const f = api(), g = mod.create(f.api);
    g.input({ type: 'knob', delta: -4 });           // from Sky (4) to Red (0)
    g.input({ type: 'press' });
    assert.strictEqual(g.colour, 0);
    g.input({ type: 'push', dir: 'E' }); g.input({ type: 'release' });   // Red -> Orange (right column)
    g.input({ type: 'push', dir: 'E' }); g.input({ type: 'release' });   // into the paper
    assert.strictEqual(g.zone, 'pen');
    g.input({ type: 'press' });                      // pen down
    g.input({ type: 'push', dir: 'E' });
    for (let t = 0; t < 500; t += 16) g.update(16);
    g.input({ type: 'release' });
    g.input({ type: 'knob', delta: 5 });
    g.input({ type: 'press' });                      // lift
    assert.strictEqual(g.pad.strokes.length, 1);
    const p = g.pad.strokes[0].p;
    assert.ok(p[p.length - 2] - p[0] > 100, 'the line goes right');
    assert.strictEqual(g.pad.strokes[0].c, 0);
    g.input({ type: 'push', dir: 'W' });
    for (let t = 0; t < 6000; t += 16) g.update(16);
    g.input({ type: 'release' });
    g.input({ type: 'push', dir: 'W' }); g.input({ type: 'release' });
    assert.strictEqual(g.zone, 'tools');
    g.draw(f.cv);
});
test('pause ends a stroke and saves it', () => {
    const f = api(), g = mod.create(f.api);
    g.input({ type: 'touch', phase: 'down', x: 400, y: 200 });
    g.input({ type: 'touch', phase: 'move', x: 500, y: 260 });
    g.pause();
    assert.strictEqual(f.saved.page.k.length, 1);
    assert.strictEqual(g.pad.cur, null);
});

console.log(failed ? failed + ' failed' : 'all passed');
process.exit(failed ? 1 : 0);
