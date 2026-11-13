'use strict';
// node apps/parked_games/games/lane-runner/test.js
const assert = require('assert');
const { Run, LANES, laneY } = require('./logic');

function rng(seed) { return () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x80000000; }; }

// lanes map to the road, clamped at the edges; knob clicks move one lane each
assert.strictEqual(Run.yFor(2), laneY(2));
assert.strictEqual(Run.yFor(0), laneY(0));
assert.strictEqual(Run.yFor(9), laneY(LANES - 1));
assert.strictEqual(Run.yFor(null), laneY(2));
{
    const r = new Run(rng(1));
    assert.strictEqual(r.lane, 2);
    assert.strictEqual(r.shift(1), 3); assert.strictEqual(r.shift(5), LANES - 1); assert.strictEqual(r.shift(-9), 0);
    for (let t = 0; t < 1000; t += 16) r.step(16);
    assert.ok(Math.abs(r.y - laneY(0)) < 1, 'the car glides into its lane');
}

// every row leaves a lane open
for (let s = 1; s < 30; s++) {
    const r = new Run(rng(s));
    r.t = 5000;
    for (let i = 0; i < 40; i++) {
        const before = r.things.length;
        r.spawn();
        const row = r.things.slice(before).filter((o) => o.kind !== 'can');
        const blocked = new Set();
        row.forEach((o) => { for (let k = 0; k < o.lanes; k++) blocked.add(o.lane + k); });
        assert.ok(blocked.size < LANES, 'a row blocks every lane');
        assert.ok(!blocked.has(r.free), 'the open lane is blocked');
        r.things = [];
    }
}

// a driver who always steers to the open lane of the nearest row ahead survives a long time; one who
// never steers crashes; distance and speed only go up
function drive(seed, smart, ms) {
    const r = new Run(rng(seed));
    let lane = 2, last = 0;
    for (let t = 0; t < ms && !r.over; t += 16) {
        if (smart) {
            const ahead = r.things.filter((o) => o.kind !== 'can' && o.x > 150).sort((a, b) => a.x - b.x)[0];
            if (ahead) {
                const row = r.things.filter((o) => o.kind !== 'can' && Math.abs(o.x - ahead.x) < 80);
                const blocked = new Set();
                row.forEach((o) => { for (let k = 0; k < o.lanes; k++) blocked.add(o.lane + k); });
                if (blocked.has(lane)) {
                    const free = [0, 1, 2, 3, 4].filter((l) => !blocked.has(l)).sort((a, b) => Math.abs(a - lane) - Math.abs(b - lane));
                    lane = free[0];
                }
            }
        }
        r.step(16, lane);
        assert.ok(r.dist >= last); last = r.dist;
    }
    return r;
}
const lazy = drive(3, false, 300000);
assert.ok(lazy.over && lazy.why === 'crash', 'not steering should crash');
let survived = 0;
for (let s = 1; s <= 10; s++) { const r = drive(s, true, 60000); if (r.metres() > 1500) survived++; }
assert.ok(survived >= 8, 'a careful driver should get far (' + survived + '/10)');

// an empty tank ends the run
const dry = new Run(rng(1));
dry.fuel = 0.001; dry.step(50);
assert.ok(dry.over && dry.why === 'fuel');

// touch: a finger on a lane steers there; touches off the road are ignored
{
    const mod = require('./index'), { ROAD, LANE_H } = require('./logic');
    const S = require('../../style');
    const g = mod.create({ random: rng(3), style: S, best: () => null, end() {}, now: () => 0 });
    g.input({ type: 'touch', phase: 'down', x: 800, y: ROAD.top + LANE_H * 0.5 });
    assert.strictEqual(g.run.lane, 0);
    g.input({ type: 'touch', phase: 'move', x: 800, y: ROAD.top + LANE_H * 4.5 });
    assert.strictEqual(g.run.lane, LANES - 1, 'a drag follows the finger');
    g.input({ type: 'touch', phase: 'down', x: 800, y: 50 });
    assert.strictEqual(g.run.lane, LANES - 1, 'the HUD is not a lane');
}

console.log('lane-runner: all passed');
