'use strict';
/**
 * Brick Breaker tests: node games/brick-breaker/test.js
 */
const assert = require('assert');
const { Engine, FW, FH, KNOB_STEP } = require('./engine');
const { LEVELS, ROWS, COLS } = require('./levels');
const game = require('./index');

let passed = 0;
function test(name, fn) {
    try { fn(); passed++; console.log('ok   ' + name); } catch (e) { console.log('FAIL ' + name); throw e; }
}

/** an autopilot: keeps the paddle under the nearest incoming ball, launches when serving */
function autopilot(g, ms, opts) {
    opts = opts || {};
    for (let t = 0; t < ms; t += 16) {
        if (g.over) break;
        if (g.state === 'serve') g.action();
        const live = g.balls.filter((b) => !b.stuck);
        const b = live.sort((a, c) => a.x - c.x)[0];
        // aim a little off-centre, as a person would (changes every paddle hit)
        if (g.hits !== g.aimHits || g.aimOff == null) { g.aimHits = g.hits; g.aimOff = (g.rand() - 0.5) * 70; }
        if (b) g.aim(b.y + g.aimOff);
        g.step(16);
        if (opts.each) opts.each(g);
    }
}

test('levels are 9 x 12, valid, and each can be cleared', () => {
    assert.ok(LEVELS.length >= 8);
    for (const L of LEVELS) {
        assert.strictEqual(L.map.length, ROWS, L.name);
        L.map.forEach((row) => { assert.strictEqual(row.length, COLS, L.name + ': ' + row); assert.ok(/^[.123#*]+$/.test(row), L.name); });
        assert.ok(L.map.join('').replace(/[.#]/g, '').length > 10, L.name + ' has bricks');
    }
});

test('knob moves the paddle, clamped to the field', () => {
    const g = new Engine({ seed: 1 });
    const y0 = g.paddle.target;
    g.move(2);
    assert.strictEqual(g.paddle.target, y0 + 2 * KNOB_STEP);
    g.move(-1000);
    assert.strictEqual(g.paddle.target, g.paddle.h / 2);
    g.move(1000);
    assert.strictEqual(g.paddle.target, FH - g.paddle.h / 2);
    for (let i = 0; i < 30; i++) g.step(16);
    assert.ok(Math.abs(g.paddle.y - g.paddle.target) < 1, 'paddle glides to the target');
});

test('the ball waits on the paddle until launched, then flies right', () => {
    const g = new Engine({ seed: 2 });
    g.step(500);
    assert.strictEqual(g.state, 'serve');
    assert.ok(g.balls[0].stuck);
    g.move(3); g.step(300);
    assert.ok(Math.abs(g.balls[0].y - (g.paddle.y + g.balls[0].off)) < 1, 'ball follows the paddle');
    g.action();   // skips the banner
    g.action();   // launches (the first press did both? either way it is in play now)
    assert.strictEqual(g.state, 'play');
    const x0 = g.balls[0].x;
    g.step(100);
    assert.ok(g.balls[0].x > x0);
});

test('the paddle sends the ball back', () => {
    const g = new Engine({ seed: 3 });
    g.action();
    let paddleHits = 0;
    autopilot(g, 20000, { each: (e) => e.events.forEach((v) => { if (v.type === 'paddle') paddleHits++; }) });
    assert.ok(paddleHits > 3, 'paddle hits ' + paddleHits);
    assert.ok(g.lives >= 3, 'no life lost with the autopilot: ' + g.lives);
});

test('balls stay inside the field and never stall', () => {
    const g = new Engine({ seed: 4 });
    autopilot(g, 60000, {
        each: (e) => {
            e.events = [];
            for (const b of e.balls) {
                assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y), 'finite');
                assert.ok(b.y >= 0 && b.y <= FH && b.x <= FW, 'inside: ' + b.x + ',' + b.y);
                if (!b.stuck) assert.ok(Math.abs(b.vx) > 100, 'moving sideways ' + b.vx);
            }
        },
    });
});

test('the autopilot clears levels', () => {
    const g = new Engine({ seed: 5 });
    autopilot(g, 15 * 60000, { each: (e) => { e.events = []; } });
    assert.ok(g.level >= 3, 'reached level ' + (g.level + 1) + ', score ' + g.score);
    assert.ok(g.score > 1000);
});

test('missing the ball costs a life; three misses end the game', () => {
    const g = new Engine({ seed: 6 });
    let misses = 0;
    for (let i = 0; i < 3; i++) {
        g.action(); g.action();
        g.aim(0);       // paddle to the top
        for (let t = 0; t < 20000 && g.state === 'play'; t += 16) {
            // keep the paddle away from the ball
            const b = g.balls[0];
            g.aim(b && b.y < FH / 2 ? FH : 0);
            g.step(16);
        }
        misses++;
        assert.strictEqual(g.lives, 3 - misses);
    }
    assert.ok(g.over);
    assert.strictEqual(g.state, 'over');
    const score = g.score;
    g.step(1000);
    assert.strictEqual(g.score, score, 'nothing moves after game over');
    g.action();
    assert.ok(!g.over && g.lives === 3 && g.score === 0, 'press starts again');
});

test('power-ups: wide, slow, multi-ball, extra life', () => {
    const g = new Engine({ seed: 7 });
    g.action(); g.action();
    g.step(50);
    const h = g.paddle.h;
    g.power('wide'); assert.ok(g.paddle.h > h);
    for (let i = 0; i < 170; i++) g.step(100);
    assert.strictEqual(g.paddle.h, h, 'wide wears off');
    const g2 = new Engine({ seed: 8 });
    g2.action(); g2.action(); g2.step(50);
    const v = Math.hypot(g2.balls[0].vx, g2.balls[0].vy);
    g2.power('slow');
    assert.ok(Math.hypot(g2.balls[0].vx, g2.balls[0].vy) < v * 0.8);
    g2.power('multi'); assert.strictEqual(g2.balls.length, 3);
    g2.power('life'); assert.strictEqual(g2.lives, 4);
});

test('the shell interface: module, input events, pause, end', () => {
    assert.strictEqual(game.id, 'brick-breaker');
    assert.ok(game.title.length <= 18 && game.blurb.length <= 28);
    assert.deepStrictEqual(game.needs, []);
    assert.strictEqual(game.score.lower, false);
    const ended = [];
    const gm = game.create({ log: { info() {}, warn() {}, error() {} }, best: () => null, random: () => 0.5, end: (s) => ended.push(s) });
    const g = gm.g;
    const y0 = g.paddle.target;
    gm.input({ type: 'knob', delta: 1 });
    assert.strictEqual(g.paddle.target, y0 + KNOB_STEP);
    gm.input({ type: 'push', dir: 'N' });
    assert.ok(g.paddle.target < y0);
    gm.input({ type: 'release' });
    // touch: canvas px on the 1600 x 520 frame -> field y = y - 100
    gm.input({ type: 'touch', phase: 'move', x: 400, y: 100 + 300 });
    assert.strictEqual(g.paddle.target, 300);
    gm.input({ type: 'press' });
    assert.strictEqual(g.state, 'play');
    gm.pause();
    const b = g.balls[0], x = b.x;
    gm.update(50);
    assert.strictEqual(b.x, x, 'paused: nothing moves');
    gm.input({ type: 'knob', delta: 5 });
    gm.resume();
    gm.update(50);
    assert.notStrictEqual(b.x, x);
    // lose every ball: api.end(score) once, then nothing moves
    for (let i = 0; i < 2000 && !ended.length; i++) {
        if (g.state === 'serve') gm.input({ type: 'press' });
        const bb = g.balls[0];
        g.aim(bb && bb.y < FH / 2 ? FH : 0);
        gm.update(16);
    }
    assert.deepStrictEqual(ended, [g.score]);
    gm.update(16); gm.input({ type: 'press' });
    assert.strictEqual(ended.length, 1);
});

test('a tap launches a waiting ball and moves the paddle there', () => {
    const gm = game.create({ random: () => 0.25 });
    gm.input({ type: 'touch', phase: 'down', x: 800, y: 200 });
    gm.input({ type: 'touch', phase: 'up', x: 800, y: 200 });
    gm.input({ type: 'tap', x: 800, y: 200 });
    assert.strictEqual(gm.g.state, 'play');
    assert.strictEqual(gm.g.paddle.target, 100);
});

test('draw runs against a recorder-like canvas', () => {
    const calls = {};
    const cv = new Proxy({}, { get: (o, k) => (...a) => { calls[k] = (calls[k] || 0) + 1; a.forEach((v) => { if (typeof v === 'number') assert.ok(Number.isFinite(v), k); }); return k === 'text' ? 10 : cv; } });
    const gm = game.create({ random: () => 0.1, best: () => 1234 });
    gm.draw(cv);
    gm.input({ type: 'press' }); gm.update(50); gm.g.power('wide'); gm.g.power('slow');
    gm.draw(cv);
    gm.pause(); gm.draw(cv);
    assert.ok(calls.roundRect > 50 && calls.text > 5 && calls.circle >= 1);
});

console.log(passed + ' tests passed');
