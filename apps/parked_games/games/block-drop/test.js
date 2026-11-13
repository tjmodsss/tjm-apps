'use strict';
// node apps/parked_games/games/block-drop/test.js   (no dependencies; exits 1 on a failure)
const assert = require('assert');
const path = require('path');
const { BlockDrop, SPARK, gravityMs } = require(path.join(__dirname, 'engine'));
const BD = require(path.join(__dirname, 'index'));

let failed = 0;
function test(name, fn) {
    try { fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + (e && e.stack || e)); }
}

const empty = (g) => { for (const row of g.board) row.fill(-1); };
const run = (g, ms) => { for (let t = 0; t < ms; t += 16) g.tick(16); };
const settle = (g) => { let n = 0; while (g.phase !== 'fall' && g.phase !== 'over' && n++ < 1000) g.tick(16); };
/** Replace the falling shard. */
function setPiece(g, kind, colours, col, row) {
    const { SHAPES } = require(path.join(__dirname, 'engine'));
    g.piece = { kind, colours: colours.slice(), cells: SHAPES[kind].cells.map((c) => c.slice()), col, row };
}

test('same seed, same shards', () => {
    const a = new BlockDrop({ seed: 42 }), b = new BlockDrop({ seed: 42 });
    for (let i = 0; i < 30; i++) {
        assert.deepStrictEqual(a.piece.kind, b.piece.kind);
        assert.deepStrictEqual(a.piece.colours, b.piece.colours);
        a.drop(); b.drop(); settle(a); settle(b);
        if (a.over()) break;
    }
});

test('shards are our own set: 1 to 3 cells, never 4', () => {
    const g = new BlockDrop({ seed: 7 });
    const seen = {};
    for (let i = 0; i < 400; i++) { const p = g._make(); seen[p.kind] = true; assert.ok(p.colours.length <= 3); }
    assert.ok(seen.bar && seen.hook && seen.pair && seen.spark);
});

test('moves stop at the walls', () => {
    const g = new BlockDrop({ seed: 1 });
    setPiece(g, 'bar', [0, 0, 0], 4, 0);
    g.move(-20);
    assert.strictEqual(Math.min.apply(null, g.pieceCells().map((c) => c[0])), 0);
    g.move(20);
    assert.strictEqual(Math.max.apply(null, g.pieceCells().map((c) => c[0])), 9);
});

test('rotate turns a bar upright and back after four turns', () => {
    const g = new BlockDrop({ seed: 1 });
    setPiece(g, 'bar', [0, 1, 2], 4, 3);
    const before = JSON.stringify(g.pieceCells());
    g.rotate();
    const xs = g.pieceCells().map((c) => c[0]);
    assert.ok(xs.every((x) => x === xs[0]), 'upright');
    g.rotate(); g.rotate(); g.rotate();
    assert.strictEqual(JSON.stringify(g.pieceCells()), before);
});

test('rotate next to a wall kicks the shard in', () => {
    const g = new BlockDrop({ seed: 1 });
    setPiece(g, 'bar', [0, 1, 2], 4, 3);
    g.rotate();                        // upright
    g.move(-20);                       // against the left wall
    assert.ok(g.rotate(), 'turned');
    assert.ok(g.pieceCells().every((c) => c[0] >= 0));
});

test('swap colours moves them round the cells', () => {
    const g = new BlockDrop({ seed: 1 });
    setPiece(g, 'hook', [0, 1, 2], 4, 3);
    g.swapColours();
    assert.deepStrictEqual(g.piece.colours, [2, 0, 1]);
});

test('gravity: the shard falls, rests, then locks', () => {
    const g = new BlockDrop({ seed: 3 });
    empty(g);
    setPiece(g, 'pair', [0, 1], 4, 0);
    run(g, gravityMs(1) * 2 + 20);
    assert.strictEqual(g.piece.row, 2);
    g.drop(); settle(g);
    assert.notStrictEqual(g.board[11][4], -1);
    assert.notStrictEqual(g.board[11][5], -1);
});

test('a full row clears and scores', () => {
    const g = new BlockDrop({ seed: 5 });
    empty(g);
    // bottom row: alternating colours (no colour group of 4) with a gap at 8, 9
    for (let c = 0; c < 8; c++) g.board[11][c] = c % 2;
    setPiece(g, 'pair', [2, 0], 8, 0);
    g.drop();
    assert.strictEqual(g.phase, 'clear');
    settle(g);
    assert.strictEqual(g.lines, 1);
    assert.ok(g.board[11].every((v) => v === -1));
    assert.ok(g.score >= 100);
});

test('four of one colour burst; loose cells fall after', () => {
    const g = new BlockDrop({ seed: 5 });
    empty(g);
    g.board[11][0] = 1; g.board[11][1] = 1; g.board[10][0] = 2;   // 2 sits on a blue
    g.board[10][1] = 0;
    setPiece(g, 'pair', [1, 1], 2, 0);
    g.drop();                                   // blue at 11/2, 11/3 -> 4 blues in a row
    settle(g);
    assert.strictEqual(g.bursts, 1);
    assert.strictEqual(g.board[11][0], 2, 'pink fell down');
    assert.strictEqual(g.board[11][1], 0, 'amber fell down');
    assert.strictEqual(g.board[11][2], -1);
});

test('a fall that makes a new group is a chain and scores double', () => {
    const g = new BlockDrop({ seed: 5 });
    empty(g);
    // row 11: blue blue blue _ pink pink pink; an upright pair (pink over blue) drops into the gap:
    // 4 blues burst, the pink falls into the gap and joins the 3 pinks: a second clear, a chain
    [1, 1, 1, -1, 2, 2, 2].forEach((v, c) => { g.board[11][c] = v; });
    setPiece(g, 'pair', [2, 1], 3, 2);
    assert.ok(g.rotate());
    assert.deepStrictEqual(g.pieceCells().map((c) => c[0]), [3, 3]);
    g.drop();
    settle(g);
    assert.strictEqual(g.bestChain, 2, 'chain ' + g.bestChain);
    assert.strictEqual(g.bursts, 2);
    assert.ok(g.board[11].every((v) => v === -1), 'all gone');
});

test('a Spark wipes the colour it lands on', () => {
    const g = new BlockDrop({ seed: 9 });
    empty(g);
    g.board[11][4] = 2; g.board[11][0] = 2; g.board[10][0] = 1; g.board[11][9] = 2;
    setPiece(g, 'spark', [SPARK], 4, 0);
    g.drop();
    settle(g);
    let pinks = 0;
    g.board.forEach((r) => r.forEach((v) => { if (v === 2) pinks++; }));
    assert.strictEqual(pinks, 0);
    assert.strictEqual(g.board[11][0], 1, 'blue fell into place');
});

test('game over when a shard cannot enter', () => {
    const g = new BlockDrop({ seed: 11 });
    let n = 0;
    while (!g.over() && n++ < 500) { g.drop(); settle(g); }
    assert.ok(g.over());
    assert.strictEqual(g.drop(), false, 'no moves after the end');
});

test('levels speed up gravity', () => {
    assert.ok(gravityMs(1) > gravityMs(5));
    assert.ok(gravityMs(50) >= 110);
});

function fakeApi(over) {
    return Object.assign({ W: 1600, H: 520, random: Math.random, best: () => 10, end: () => {}, theme: () => ({ bg: '#000000', text: '#ffffff', panel: [1, 2, 3, 255] }), log: console }, over || {});
}

test('index: module fields match GAMES.md', () => {
    assert.strictEqual(BD.id, 'block-drop');
    assert.ok(typeof BD.title === 'string' && BD.title.length <= 18);
    assert.ok(typeof BD.blurb === 'string' && BD.blurb.length <= 28);
    assert.ok(Array.isArray(BD.needs) && typeof BD.order === 'number');
    assert.strictEqual(BD.score.lower, false);
});

test('index: knob, push and touch drive the game; end() is called once', () => {
    const ends = [];
    const game = BD.create(fakeApi({ end: (n) => ends.push(n) }));
    const e = game.engine;
    const col0 = e.piece.col;
    game.input({ type: 'knob', delta: -2 });
    assert.strictEqual(e.piece.col, col0 - 2);
    game.input({ type: 'push', dir: 'E' });
    assert.strictEqual(e.piece.col, col0 - 1);
    game.input({ type: 'touch', phase: 'down', x: 1300, y: 420 });   // the Drop button
    assert.ok(e.board[11].some((v) => v !== -1), 'dropped and locked');
    let n = 0;
    while (!game.state().over && n++ < 3000) { game.input({ type: 'push', dir: 'S' }); game.update(50); }
    assert.ok(game.state().over);
    for (let i = 0; i < 20; i++) game.update(50);
    assert.strictEqual(ends.length, 1);
    assert.strictEqual(ends[0], e.score);
});

test('index: paused, nothing moves', () => {
    const game = BD.create(fakeApi());
    const e = game.engine;
    game.pause();
    const row = e.piece.row, col = e.piece.col;
    game.update(50); game.update(50); game.update(50);
    for (let i = 0; i < 40; i++) game.update(50);
    game.input({ type: 'knob', delta: 1 });
    assert.strictEqual(e.piece.row, row);
    assert.strictEqual(e.piece.col, col);
    game.resume();
    for (let i = 0; i < 40; i++) game.update(50);
    assert.ok(e.piece.row > row || e.piece !== null);
});

test('index: draws with the kit calls only (no triangle, no clear)', () => {
    const calls = {};
    const allowed = ['fillRect', 'roundRect', 'strokeRoundRect', 'gradientRect', 'circle', 'arc', 'line', 'polyline', 'quad', 'text', 'textWidth', 'alpha', 'clip', 'noclip'];
    const cv = new Proxy({}, { get: (o, k) => {
        if (allowed.indexOf(k) < 0) throw new Error('cv.' + String(k) + ' is not in GAMES.md');
        return function () { calls[k] = (calls[k] || 0) + 1; return k === 'text' ? 10 : cv; };
    } });
    const game = BD.create(fakeApi());
    for (let i = 0; i < 50; i++) { game.update(16); game.draw(cv); }
    game.engine.phase = 'over';
    game.draw(cv);
    assert.ok(calls.roundRect > 50 && calls.text > 10 && calls.quad >= 4);
});

if (failed) { console.log(failed + ' failed'); process.exit(1); }
console.log('all passed');
