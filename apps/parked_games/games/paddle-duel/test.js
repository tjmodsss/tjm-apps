'use strict';
/** node apps/parked_games/games/paddle-duel/test.js - the game's rules, without a car or a renderer */
const assert = require('assert');
const { PaddleDuel, COURT, PADDLE, BALL_R } = require('./game');
const plugin = require('./index');
const look = require('./draw');

let seed = 1;
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const run = (g, s) => { for (let i = 0; i < Math.round(s * 60); i++) g.update(1 / 60); };
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('a press starts a match', () => {
    const g = new PaddleDuel({ random: rnd });
    assert.strictEqual(g.state, 'ready');
    assert.strictEqual(g.press(), 'start');
    assert.strictEqual(g.state, 'serve');
    run(g, 1.2);
    assert.strictEqual(g.state, 'play');
    assert.ok(Math.abs(g.ball.vx) > 0);
});

test('a ball the paddle misses scores for the other side', () => {
    const g = new PaddleDuel({ left: 'knob', right: 'cpu', random: rnd });
    g.press(); run(g, 1.2);
    const b = g.ball;
    b.x = 300; b.y = COURT.top + 40; b.vx = -900; b.vy = 0; b.spin = 0;
    g.L.y = g.L.target = COURT.bottom - PADDLE.h / 2;      // far away from the ball
    run(g, 0.5);
    assert.strictEqual(g.R.score, 1);
    assert.strictEqual(g.state, 'point');
});

test('a paddle in the way sends the ball back, faster, at an angle set by where it hit', () => {
    const g = new PaddleDuel({ left: 'knob', right: 'knob', random: rnd });
    g.press(); run(g, 1.2);
    const b = g.ball, mid = (COURT.top + COURT.bottom) / 2;
    g.L.y = g.L.target = mid;
    b.x = 200; b.y = mid + 40; b.vx = -700; b.vy = 0; b.spin = 0; b.speed = 700;
    run(g, 0.3);
    assert.ok(b.vx > 0, 'bounced back');
    assert.ok(b.vy > 0, 'hit below the centre: leaves downwards');
    assert.ok(b.speed > 700, 'faster');
    assert.strictEqual(g.rally, 1);
});

test('a moving paddle puts spin on the ball, and the spin curves it', () => {
    const g = new PaddleDuel({ left: 'knob', right: 'knob', random: rnd });
    g.press(); run(g, 1.2);
    const b = g.ball, mid = (COURT.top + COURT.bottom) / 2;
    g.L.y = mid; g.L.setTarget(mid + 200);                 // moving down at the hit
    b.x = PADDLE.inset + PADDLE.w / 2 + BALL_R + 4; b.y = mid; b.vx = -700; b.vy = 0; b.spin = 0;
    g.update(1 / 60);
    assert.ok(b.spin > 0, 'spin from the paddle moving down: ' + b.spin);
});

test('the ball stays inside the walls', () => {
    const g = new PaddleDuel({ left: 'cpu', right: 'cpu', cpu: 'hard', random: rnd });
    g.press();
    for (let i = 0; i < 60 * 60; i++) {
        g.update(1 / 60);
        if (g.state === 'play') assert.ok(g.ball.y >= COURT.top + BALL_R - 0.01 && g.ball.y <= COURT.bottom - BALL_R + 0.01, 'y ' + g.ball.y);
        if (g.state === 'over') break;
    }
});

test('two cars play a whole match to the target, with rallies and the bumper', () => {
    const g = new PaddleDuel({ left: 'cpu', right: 'cpu', cpu: 'normal', target: 5, random: rnd });
    g.press();
    for (let i = 0; i < 60 * 600 && g.state !== 'over'; i++) g.update(1 / 60);
    assert.strictEqual(g.state, 'over');
    assert.ok(g.L.score === 5 || g.R.score === 5);
    assert.ok(g.bumperOn, 'bumper came on after the first point');
    assert.ok(g.longest >= 1, 'someone hit the ball: ' + g.longest);
});

test('knob clicks move the knob player\'s paddle', () => {
    const g = new PaddleDuel({ left: 'cpu', right: 'knob', knobStep: 30, random: rnd });
    const t0 = g.R.target;
    g.knob(2);
    assert.strictEqual(g.R.target, t0 + 60);
    g.knob(-100);
    assert.ok(g.R.target < t0, 'clamped to the top');
});

test('pause freezes the ball, a press resumes', () => {
    const g = new PaddleDuel({ left: 'cpu', right: 'cpu', random: rnd });
    g.press(); run(g, 1.5);
    g.pause();
    const x = g.ball.x;
    run(g, 0.5);
    assert.strictEqual(g.ball.x, x);
    assert.strictEqual(g.press(), 'resume');
    run(g, 0.1);
    assert.notStrictEqual(g.ball.x, x);
});

/** a fake shell (GAMES.md api) */
function shell() {
    const saved = {};
    const api = {
        W: 1600, H: 520, now: () => 0, random: rnd, log: { info() {}, warn() {}, error() {} },
        theme: () => ({}), best: () => null, top: () => [],
        end: (score) => { api.ended = (api.ended || 0) + 1; api.score = score; },
        store: { get: (k) => saved[k], set: (k, v) => { saved[k] = v; } },
        saved,
    };
    return api;
}
const play = (game, s) => { for (let i = 0; i < Math.round(s * 60); i++) game.update(1000 / 60); };
const MIDY = (COURT.top + COURT.bottom) / 2;
/** past the setup card: the match on with the stored (or default) choices */
const begun = (api) => { const g = plugin.create(api); g.start(); return g; };

test('plugin: the module has what the shell reads', () => {
    assert.strictEqual(plugin.id, 'paddle-duel');
    assert.ok(plugin.title.length <= 16 && plugin.blurb.length <= 28);
    assert.deepStrictEqual(plugin.needs, []);
    assert.strictEqual(plugin.score.lower, false);
    const g = plugin.create(shell());
    ['update', 'draw', 'input', 'pause', 'resume'].forEach((k) => assert.strictEqual(typeof g[k], 'function', k));
});

test('plugin: the knob plays the left paddle against the car', () => {
    const game = begun(shell()), g = game.g;
    play(game, 0.1);
    assert.strictEqual(g.L.ctl, 'knob');
    assert.strictEqual(g.R.ctl, 'cpu');
    game.input({ type: 'knob', delta: 4 }); play(game, 0.5);
    assert.ok(g.L.y > MIDY + 100, 'clockwise: paddle down ' + g.L.y);
    game.input({ type: 'push', dir: 'N' }); play(game, 0.5); game.input({ type: 'release' });
    assert.ok(g.L.y < MIDY, 'push up slides it up ' + g.L.y);
});

test('plugin: push left / right before the first serve picks your side and remembers it', () => {
    const api = shell();
    const game = begun(api);
    game.input({ type: 'push', dir: 'E' });
    play(game, 0.05);
    assert.strictEqual(game.g.R.ctl, 'knob');
    assert.strictEqual(game.g.L.ctl, 'cpu');
    assert.strictEqual(api.saved.side, 'R');
    const again = begun(api);
    play(again, 0.05);
    assert.strictEqual(again.g.R.ctl, 'knob', 'remembered');
});

test('plugin: a touch on the other half takes the car\'s paddle for a second player', () => {
    const game = begun(shell());
    game.input({ type: 'touch', phase: 'down', x: 300, y: COURT.top + 60 });
    assert.strictEqual(game.g.R.ctl, 'cpu', 'your own half does not call a second player');
    assert.ok(game.g.L.target < MIDY, 'alone, a finger on your half moves your paddle');
    game.input({ type: 'touch', phase: 'down', x: 1300, y: COURT.top + 60 });
    assert.strictEqual(game.g.R.ctl, 'touch');
    assert.strictEqual(game.g.L.ctl, 'knob');
    assert.ok(game.g.R.target < MIDY);
    // two players: the knob player's half no longer answers touch, the knob still moves it
    const before = game.g.L.target;
    game.input({ type: 'touch', phase: 'move', x: 300, y: COURT.bottom - 20 });
    assert.strictEqual(game.g.L.target, before, 'player 2 cannot move player 1\'s paddle');
    game.input({ type: 'knob', delta: 3 });
    assert.ok(game.g.L.target > before, 'the knob still does');
});

test('plugin: two players either way round: knob on the right, touch on the left', () => {
    const game = begun(shell());
    game.input({ type: 'push', dir: 'E' });
    game.input({ type: 'touch', phase: 'down', x: 300, y: COURT.bottom - 40 });
    assert.strictEqual(game.g.L.ctl, 'touch');
    assert.strictEqual(game.g.R.ctl, 'knob');
    assert.ok(game.g.L.target > MIDY);
});

test('plugin: a whole match ends with api.end(longest rally), once', () => {
    const api = shell();     // the player never turns: the car wins
    const game = begun(api);
    for (let i = 0; i < 60 * 900 && !api.ended; i++) game.update(1000 / 60);
    assert.strictEqual(api.ended, 1);
    assert.ok(typeof api.score === 'number');
    play(game, 1);
    assert.strictEqual(api.ended, 1);
});

test('plugin: pause stops the ball', () => {
    const game = begun(shell());
    play(game, 1.5);
    game.pause();
    const x = game.g.ball.x;
    play(game, 0.5);
    assert.strictEqual(game.g.ball.x, x);
    game.resume(); play(game, 0.1);
    assert.notStrictEqual(game.g.ball.x, x);
});

test('plugin: a setup card first: nothing moves until Start', () => {
    const game = plugin.create(shell());
    play(game, 2);
    assert.strictEqual(game.setup, true);
    assert.strictEqual(game.g.state, 'ready');
    game.input({ type: 'press' });                       // on Opponent: Car -> 2 players
    assert.strictEqual(game.two, true);
    assert.strictEqual(game.g.state, 'ready', 'a press on a row changes it, it does not start');
});

test('plugin: setup with the knob: 2 players, knob on the right, Start', () => {
    const api = shell();
    const game = plugin.create(api);
    game.input({ type: 'press' });                       // 2 players
    game.input({ type: 'knob', delta: 1 });              // Knob plays
    game.input({ type: 'push', dir: 'E' });              // Right
    game.input({ type: 'knob', delta: 3 });              // Start (clamped)
    game.input({ type: 'press' });
    assert.strictEqual(game.setup, false);
    assert.strictEqual(game.g.R.ctl, 'knob');
    assert.strictEqual(game.g.L.ctl, 'touch');
    assert.strictEqual(game.joined, true);
    assert.strictEqual(api.saved.two, true);
    assert.strictEqual(api.saved.side, 'R');
    // remembered for the next match
    const again = plugin.create(api);
    again.start();
    assert.strictEqual(again.g.L.ctl, 'touch');
});

test('plugin: setup by touch: the car on Hard', () => {
    const api = shell();
    const game = plugin.create(api);
    const rects = look.setupRects(game);
    const lv = rects.find((r) => r.row === 'level'), st = rects.find((r) => r.row === 'start');
    game.input({ type: 'touch', phase: 'down', x: lv.opts[2].x + 10, y: lv.y + 30 });
    game.input({ type: 'touch', phase: 'up', x: lv.opts[2].x + 10, y: lv.y + 30 });
    assert.strictEqual(game.level, 'hard');
    game.input({ type: 'touch', phase: 'up', x: st.x + 50, y: st.y + 20 });
    assert.strictEqual(game.setup, false);
    assert.strictEqual(game.g.o.cpu, 'hard');
    assert.strictEqual(game.g.R.ctl, 'cpu');
    assert.strictEqual(api.saved.level, 'hard');
});

test('draws a frame on a recorder-like canvas without throwing', () => {
    const calls = [];
    const cv = new Proxy({}, { get: (o, k) => (...a) => { calls.push(k); return k === 'text' ? 10 : cv; } });
    const g = new PaddleDuel({ random: rnd });
    g.draw(cv, {}); g.press(); run(g, 2); g.draw(cv, {});
    assert.ok(calls.indexOf('circle') >= 0 && calls.indexOf('roundRect') >= 0);
});

let fail = 0;
tests.forEach(([name, fn]) => {
    try { fn(); console.log('ok   ' + name); } catch (e) { fail++; console.log('FAIL ' + name + '\n     ' + (e && e.stack || e)); }
});
console.log(fail ? fail + ' failed' : 'all ' + tests.length + ' passed');
process.exit(fail ? 1 : 0);
