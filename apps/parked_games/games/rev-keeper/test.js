'use strict';
/**
 * Rev Keeper without a car: node apps/parked_games/games/rev-keeper/test.js
 * Plays rounds with scripted players and checks the rules and the shell interface.
 */
const assert = require('assert');
const { RevKeeper, seeded, COUNT_S, LO, HI } = require('./logic');
const mod = require('./index');

const DT = 1 / 60;
let n = 0;
const test = (name, fn) => { fn(); n++; console.log('ok  ' + name); };

function counted(seed, onOver) {
    const g = new RevKeeper({ random: seeded(seed), onOver });
    for (let t = 0; t < COUNT_S + 0.05; t += DT) g.update(DT);
    assert.strictEqual(g.state, 'play');
    return g;
}

/** Play up to `s` seconds with player(game) -> 0..1. */
function run(seed, player, s) {
    const g = counted(seed);
    let t = 0, maxMult = 1;
    for (; t < s && g.state === 'play'; t += DT) { g.setInput(player(g)); g.update(DT); maxMult = Math.max(maxMult, g.mult); }
    return { g, t, maxMult };
}

/** Aims a little ahead of the zone, and at the ghost just before a jump: the best a player can do. */
function sharp() {
    let pc = null;
    return (g) => {
        const v = pc === null ? 0 : (g.zone.c - pc) / DT, j = g.pendingJump();
        pc = g.zone.c;
        return j && j.t > j.warn - 0.1 ? j.to : g.zone.c + v * 0.1;
    };
}

/** A human-ish player: aims where the zone was `delayS` ago. */
function lagging(delayS) {
    const hist = [];
    return (g) => { hist.push(g.zone.c); return hist[Math.max(0, hist.length - 1 - Math.round(delayS / DT))]; };
}

test('a round counts down, then plays', () => {
    const g = new RevKeeper({ random: seeded(1) });
    assert.strictEqual(g.state, 'count');
    g.setInput(0); g.update(1); assert.strictEqual(g.state, 'count');
    assert.strictEqual(g.strain, 0);
    counted(1);
});

test('doing nothing blows the engine within ~5 s', () => {
    const { g, t } = run(2, () => 0, 30);
    assert.strictEqual(g.state, 'over');
    assert.ok(t > 1 && t < 6, 'over after ' + t.toFixed(2) + ' s');
    assert.ok(g.score < 15, 'score ' + g.score);
});

test('over-revving strains faster than bogging down by the same amount', () => {
    const over = run(3, (g) => g.zone.c + g.zone.w + 0.1, 30).t, under = run(3, (g) => g.zone.c - g.zone.w - 0.1, 30).t;
    assert.ok(over < under, 'over ' + over.toFixed(2) + ' s, under ' + under.toFixed(2) + ' s');
});

test('a sharp player survives 5 minutes and reaches x8', () => {
    for (let seed = 4; seed < 9; seed++) {
        const { g, maxMult } = run(seed, sharp(), 300);
        assert.strictEqual(g.state, 'play', 'seed ' + seed + ' ended at level ' + g.level);
        assert.strictEqual(maxMult, 8);
        assert.strictEqual(g.level, 26);
    }
});

test('a player 0.25 s behind lasts a while but has to work for it', () => {
    let total = 0, strainSeen = 0;
    for (let seed = 10; seed < 20; seed++) {
        const r = run(seed, lagging(0.25), 120);
        total += r.t; strainSeen = Math.max(strainSeen, r.g.strain);
    }
    const avg = total / 10;
    assert.ok(avg > 25 && avg < 119, 'average survival ' + avg.toFixed(1) + ' s');
    assert.ok(strainSeen > 0.3, 'strain never mattered: ' + strainSeen);
    console.log('    (0.25 s behind: average survival ' + avg.toFixed(1) + ' s of 120)');
});

test('the zone stays on the scale and narrows with the level', () => {
    const g = counted(5);
    const w1 = g.width(1), p = sharp();
    for (let t = 0; t < 150; t += DT) {
        g.setInput(p(g)); g.update(DT);
        assert.ok(g.zone.c - g.zone.w >= LO - 1e-9 && g.zone.c + g.zone.w <= HI + 1e-9, 'zone ' + JSON.stringify(g.zone));
    }
    assert.ok(g.width(g.level) < w1);
    assert.ok(g.width(99) >= 0.05);
});

test('same seed, same round', () => {
    assert.strictEqual(run(7, lagging(0.2), 40).g.score, run(7, lagging(0.2), 40).g.score);
});

test('the needle climbs faster than it falls', () => {
    const g = new RevKeeper({ random: seeded(1) });
    g.setInput(1); for (let i = 0; i < 6; i++) g.update(DT);
    const up = g.needle;
    g.needle = 1; g.setInput(0); for (let i = 0; i < 6; i++) g.update(DT);
    assert.ok(up > 1 - g.needle, 'up ' + up + ', down ' + (1 - g.needle));
});

test('a long stall does not teleport the game', () => {
    const g = counted(6), t0 = g.playT;
    g.setInput(1); g.update(5);
    assert.ok(g.playT - t0 <= 0.1 + 1e-9 && g.state === 'play', 'played ' + (g.playT - t0) + ' s of a 5 s stall');
});

/* ---------- the shell interface (GAMES.md) ---------- */
function fakeApi() {
    const ends = [];
    const api = {
        W: 1600, H: 520, now: () => 0, random: seeded(42), log: { info() {}, warn() {}, error() {} },
        theme: () => ({}), best: () => 120, top: () => [], end: (s) => ends.push(s),
        store: { get() {}, set() {} },
    };
    return { api, ends };
}
/** Turn the knob towards a throttle level (0..1), one click at a time. */
function knobTo(game, v) {
    const want = Math.round(v * 25), have = Math.round(game.throttle * 25);
    if (want !== have) game.input({ type: 'knob', delta: want > have ? 1 : -1 });
}

test('module shape', () => {
    assert.strictEqual(mod.id, 'rev-keeper');
    assert.ok(mod.title.length <= 16 && mod.blurb.length <= 28);
    assert.deepStrictEqual(mod.needs, []);
    assert.strictEqual(mod.score.lower, false);
    assert.strictEqual(typeof mod.create, 'function');
});

test('the knob is the throttle: 4 % a click, push up / down a fifth, clamped', () => {
    const game = mod.create(fakeApi().api);
    game.input({ type: 'knob', delta: 5 }); assert.ok(Math.abs(game.throttle - 0.2) < 1e-9);
    game.input({ type: 'push', dir: 'N' }); assert.ok(Math.abs(game.throttle - 0.4) < 1e-9);
    game.input({ type: 'push', dir: 'S' }); game.input({ type: 'push', dir: 'S' }); game.input({ type: 'push', dir: 'S' });
    assert.strictEqual(game.throttle, 0);
    game.input({ type: 'knob', delta: 99 }); assert.strictEqual(game.throttle, 1);
});

test('plays through the api: a knob player at 2 clicks a frame keeps up, end() once with a whole score', () => {
    const { api, ends } = fakeApi();
    const game = mod.create(api);
    for (let t = 0; t < 3000; t += 16) game.update(16);       // the countdown
    let f = 0;
    for (let t = 0; t < 20000; t += 16) { if (f++ % 3) knobTo(game, game.g.zone.c); game.update(16); }
    assert.strictEqual(ends.length, 0, 'a knob player on the zone ended the round');
    assert.ok(game.g.score > 100);
    game.input({ type: 'knob', delta: 30 });
    for (let t = 0; t < 30000; t += 16) game.update(16);
    assert.strictEqual(ends.length, 1);
    assert.strictEqual(ends[0], Math.floor(ends[0]));
    game.update(16); game.input({ type: 'press' }); game.input({ type: 'knob', delta: 3 });
    assert.strictEqual(ends.length, 1);
});

test('draws every state with only the documented canvas calls', () => {
    const allowed = ['fillRect', 'roundRect', 'strokeRoundRect', 'gradientRect', 'circle', 'arc', 'line', 'polyline', 'quad', 'text', 'textWidth', 'alpha', 'clip', 'noclip'];
    const big = [];
    const cv = new Proxy({}, {
        get: (o, k) => {
            assert.ok(allowed.indexOf(k) >= 0, 'cv.' + String(k) + ' is not in GAMES.md');
            return (...a) => { if (k === 'text' && a[3] > 40 && /[^0-9 .x%-]/.test(a[0])) big.push(a[0]); return 10; };
        },
    });
    const { api } = fakeApi();
    const game = mod.create(api);
    game.draw(cv);                                               // countdown
    for (let t = 0; t < 6000; t += 16) { knobTo(game, game.g.zone.c); game.update(16); }
    game.draw(cv); game.pause(); game.draw(cv); game.resume();
    game.input({ type: 'knob', delta: 30 }); for (let t = 0; t < 30000; t += 16) game.update(16);
    game.draw(cv);
    assert.strictEqual(game.g.state, 'over');
    assert.deepStrictEqual(big, [], 'words over size 40: ' + big.join(', '));
});

test('touch: the strip is a throttle slider', () => {
    const game = mod.create(fakeApi());
    game.input({ type: 'touch', phase: 'down', x: 80 + 1440 * 0.75, y: 250 });
    assert.ok(Math.abs(game.throttle - 0.75) < 1e-9);
    game.input({ type: 'touch', phase: 'move', x: 0, y: 250 });
    assert.strictEqual(game.throttle, 0);
    game.input({ type: 'touch', phase: 'move', x: 1600, y: 250 });
    assert.strictEqual(game.throttle, 1);
    game.input({ type: 'touch', phase: 'down', x: 800, y: 80 });
    assert.strictEqual(game.throttle, 1, 'the score row is not the slider');
    game.input({ type: 'knob', delta: -5 });
    assert.ok(Math.abs(game.throttle - 0.8) < 1e-9, 'the knob carries on from the finger');
});

console.log(n + ' tests passed');
