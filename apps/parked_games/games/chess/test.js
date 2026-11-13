'use strict';
/**
 * Chess tests: the rules (perft counts of well-known positions), notation, the engine, and the
 * game played with the knob and with touch, against the computer and two players.
 *
 *   node apps/parked_games/games/chess/test.js
 */
const assert = require('assert');
const path = require('path');
const E = require('./engine');
const chess = require('./index');
const look = require('./look');
const S = require(path.join(__dirname, '..', '..', 'style'));

let failed = 0;
function test(name, fn) {
    try { fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + (e && e.stack || e).split('\n').slice(0, 5).join('\n     ')); }
}

/* ---------- the rules ---------- */
const PERFT = [
    ['rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 4, 197281],
    ['r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', 3, 97862],
    ['8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', 4, 43238],
    ['r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', 3, 9467],
    ['rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', 3, 62379],
];
PERFT.forEach((c, i) => test('perft ' + (i + 1) + ': ' + c[2] + ' positions at depth ' + c[1], () => {
    const b = new E.Board(c[0]);
    assert.strictEqual(E.perft(b, c[1]), c[2]);
    assert.strictEqual(b.fen(), c[0], 'the board is as it was');
}));
test('FEN in and out', () => {
    const f = 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1';
    assert.strictEqual(new E.Board(f).fen(), f);
    assert.throws(() => new E.Board('nonsense'));
});
test('notation: SAN for castling, captures, promotion, check and mate', () => {
    const b = new E.Board('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    assert.strictEqual(b.san(b.fromUci('e1g1')), 'O-O');
    assert.strictEqual(b.san(b.fromUci('e1c1')), 'O-O-O');
    assert.strictEqual(b.san(b.fromUci('a1a8')), 'Rxa8+');
    const p = new E.Board('7k/P7/8/8/8/8/8/K7 w - - 0 1');
    assert.strictEqual(p.san(p.fromUci('a7a8q')), 'a8=Q+');
    const m = new E.Board('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1');
    assert.strictEqual(m.san(m.fromUci('a1a8')), 'Ra8#');
    const d = new E.Board('k7/8/8/8/8/8/8/KN3N2 w - - 0 1');
    assert.strictEqual(d.san(d.fromUci('b1d2')), 'Nbd2');
    assert.strictEqual(new E.Board().san(new E.Board().fromUci('g1f3')), 'Nf3');
});
test('en passant and its hash', () => {
    const b = new E.Board('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1');
    const m = b.fromUci('e5d6');
    assert.ok(m && (E.mFlags(m) & E.F_EP));
    b.play(m);
    assert.strictEqual(b.fen(), '4k3/8/3P4/8/8/8/8/4K3 b - - 0 1');
    const lo = b.lo, hi = b.hi;
    b.rehash();
    assert.strictEqual(b.lo, lo); assert.strictEqual(b.hi, hi);
});
test('status: checkmate, stalemate, repetition, fifty moves, material', () => {
    assert.strictEqual(new E.Board('R5k1/5ppp/8/8/8/8/8/6K1 b - - 1 1').status().why, 'checkmate');
    assert.strictEqual(new E.Board('R5k1/5ppp/8/8/8/8/8/6K1 b - - 1 1').status().winner, 0);
    assert.strictEqual(new E.Board('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1').status().why, 'stalemate');
    assert.strictEqual(new E.Board('7k/8/6K1/8/8/8/8/8 b - - 0 1').status().why, 'material');
    assert.strictEqual(new E.Board('7k/8/6K1/8/8/8/8/R7 b - - 100 80').status().why, 'fifty');
    const b = new E.Board();
    ['g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3', 'g8f6', 'f3g1', 'f6g8'].forEach((u) => assert.ok(b.play(b.fromUci(u)), u));
    assert.strictEqual(b.status().why, 'repetition');
    assert.strictEqual(new E.Board().status().over, false);
});
test('castling is not allowed through check', () => {
    const b = new E.Board('4k3/8/8/8/8/8/5r2/R3K2R w KQ - 0 1');
    assert.ok(!b.fromUci('e1g1'), 'f1 attacked... no, f2 rook attacks f1');
    assert.ok(b.fromUci('e1c1'));
});

/* ---------- the engine ---------- */
function think(b, level, budget) {
    const s = new E.Search(b, level, () => 0.5);
    let n = 0;
    while (!s.step(budget || 2000)) { n++; assert.ok(n < 5000, 'thinks forever'); }
    return s;
}
test('engine: finds a mate in one at every level', () => {
    ['easy', 'medium', 'hard'].forEach((lv) => {
        const b = new E.Board('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1');
        assert.strictEqual(b.san(think(b, E.LEVELS[lv]).best), 'Ra8#', lv);
    });
});
test('engine: takes a free queen (medium, hard)', () => {
    ['medium', 'hard'].forEach((lv) => {
        const b = new E.Board('4k3/8/8/3q4/8/8/8/3RK3 w - - 0 1');
        assert.strictEqual(b.uci(think(b, E.LEVELS[lv]).best), 'd1d5', lv);
    });
});
test('engine: hard finds a mate in two', () => {
    const b = new E.Board('6k1/5ppp/8/8/8/8/1Q6/1R4K1 w - - 0 1');
    const s = think(b, E.LEVELS.hard);
    assert.ok(s.score > E.MATE - 10, 'sees the mate (' + s.score + ')');
});
test('engine: stops in slices and leaves the board as it was', () => {
    const b = new E.Board('r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4');
    const f = b.fen(), s = new E.Search(b, E.LEVELS.hard, () => 0.5);
    let steps = 0;
    while (!s.step(500)) { steps++; assert.strictEqual(b.fen(), f); }
    assert.ok(steps > 3, 'it took several slices (' + steps + ')');
    assert.ok(s.nodes <= E.LEVELS.hard.nodes + 5000, 'and kept to its node budget (' + s.nodes + ')');
    assert.ok(b.legal().indexOf(s.best) >= 0);
});

/* ---------- the game ---------- */
function make(store) {
    const st = store || {};
    let ended = null, t = 0;
    const api = {
        W: 1600, H: 520, now: () => t, random: () => 0.3, log: { info() {}, warn() {}, error() {} }, theme: () => ({}), style: S,
        best: () => null, top: () => [], store: { get: (k) => (st[k] === undefined ? undefined : JSON.parse(JSON.stringify(st[k]))), set: (k, v) => { st[k] = v; } },
        end(score) { assert.strictEqual(ended, null, 'end() twice'); ended = score; },
    };
    const g = chess.create(api);
    return { g, st, ended: () => ended, run(ms) { for (let i = 0; i < ms; i += 33) { t += 33; g.update(33); } } };
}
const knob = (d) => ({ type: 'knob', delta: d });
const press = { type: 'press' };
const center = (g, name) => { const p = look.sqXY(g, E.sqOf(name)); return { x: p.x + 28, y: p.y + 28 }; };
const tapAt = (g, name) => { const c = center(g, name); g.input({ type: 'touch', phase: 'down', x: c.x, y: c.y }); g.input({ type: 'touch', phase: 'up', x: c.x, y: c.y }); g.input({ type: 'tap', x: c.x, y: c.y }); };
const dragTo = (g, a, b) => { const p = center(g, a), q = center(g, b); g.input({ type: 'touch', phase: 'down', x: p.x, y: p.y }); g.input({ type: 'touch', phase: 'move', x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }); g.input({ type: 'touch', phase: 'move', x: q.x, y: q.y }); g.input({ type: 'touch', phase: 'up', x: q.x, y: q.y }); };
/** Knob: turn to a square among the items, press. */
function knobTo(g, name) {
    const sq = E.sqOf(name);
    for (let i = 0; i < 40; i++) { if (g.cursor.kind === 'sq' && g.cursor.sq === sq) { g.input(press); return; } g.input(knob(1)); }
    throw new Error('the knob never reached ' + name);
}
function draws(g) {
    const ops = ['fillRect', 'roundRect', 'strokeRoundRect', 'gradientRect', 'circle', 'arc', 'line', 'polyline', 'quad', 'text', 'textWidth', 'alpha', 'clip', 'noclip', 'rampRect', 'card', 'target'];
    const cv = {};
    ops.forEach((o) => { cv[o] = function () { Array.prototype.slice.call(arguments, 0, 4).forEach((v) => { if (typeof v === 'number') assert.ok(isFinite(v), o + ': NaN'); }); return o === 'text' || o === 'textWidth' ? 10 : cv; }; });
    g.draw(cv);
}

test('setup: the knob chooses the opponent and starts', () => {
    const r = make(), g = r.g;
    assert.strictEqual(g.state, 'setup');
    draws(g);
    g.input(knob(-5));                        // to the top row: Opponent (one row a click)
    g.input({ type: 'push', dir: 'E' });      // Friend
    assert.strictEqual(g.prefs.mode, 'friend');
    g.input({ type: 'push', dir: 'W' });
    assert.strictEqual(g.prefs.mode, 'computer');
    g.input(knob(1)); g.input(press);         // Level: Easy -> Medium
    assert.strictEqual(g.prefs.level, 'medium');
    g.input(knob(5)); g.input(press);         // Start
    assert.strictEqual(g.state, 'play');
    assert.strictEqual(r.st.prefs.level, 'medium');
    draws(g);
});
test('knob: pick up a pawn, choose its square, the computer answers', () => {
    const r = make(), g = r.g;
    g.input(knob(5)); g.input(press);
    knobTo(g, 'e2');
    assert.strictEqual(g.sel, E.sqOf('e2'));
    knobTo(g, 'e4');
    assert.strictEqual(g.sans[0], 'e4');
    assert.ok(g.anim);
    r.run(400);
    assert.ok(g.think, 'the computer thinks');
    draws(g);
    r.run(3000);
    assert.strictEqual(g.sans.length, 2, 'and moves');
    assert.ok(g.canMove('knob') && g.canMove('touch'));
});
test('knob: push moves the cursor, pressing the picked-up piece puts it back', () => {
    const r = make(), g = r.g;
    g.input(knob(5)); g.input(press);
    g.cursor = { kind: 'sq', sq: E.sqOf('d1') };
    g.input({ type: 'push', dir: 'N' });
    assert.strictEqual(g.cursor.sq, E.sqOf('d2'));
    g.input(press);
    assert.strictEqual(g.sel, E.sqOf('d2'));
    g.input(press);
    assert.strictEqual(g.sel, -1);
    g.cursor = { kind: 'sq', sq: E.sqOf('h4') };
    g.input({ type: 'push', dir: 'E' });
    assert.deepStrictEqual(g.cursor, { kind: 'btn', id: 'undo' });
    g.input({ type: 'push', dir: 'E' });
    assert.deepStrictEqual(g.cursor, { kind: 'btn', id: 'resign' });
});
test('touch: tap a piece then a square, or drag it', () => {
    const r = make(), g = r.g;
    g.input(knob(5)); g.input(press);
    tapAt(g, 'g1');
    assert.strictEqual(g.sel, E.sqOf('g1'));
    tapAt(g, 'g1');
    assert.strictEqual(g.sel, -1, 'a second tap puts it back');
    tapAt(g, 'g1'); tapAt(g, 'f3');
    assert.strictEqual(g.sans[0], 'Nf3');
    r.run(4000);
    assert.strictEqual(g.sans.length, 2);
    dragTo(g, 'e2', 'e4');
    assert.strictEqual(g.sans[2], 'e4');
});
test('touch: buttons, resign needs a second press', () => {
    const r = make(), g = r.g;
    g.input(knob(5)); g.input(press);
    tapAt(g, 'e2'); tapAt(g, 'e4');
    r.run(4000);
    const btn = (id) => { const b = look.buttonRects(g).find((q) => q.id === id); g.input({ type: 'touch', phase: 'down', x: b.x + 10, y: b.y + 10 }); g.input({ type: 'touch', phase: 'up', x: b.x + 10, y: b.y + 10 }); };
    btn('undo');
    assert.strictEqual(g.sans.length, 0, 'take back: both moves');
    assert.strictEqual(g.b.ply, 0);
    btn('resign');
    assert.ok(!g.result && g.confirm);
    btn('resign');
    assert.strictEqual(g.result.why, 'resign');
    r.run(3000);
    assert.strictEqual(r.ended(), 0, 'a resigned game scores 0');
});
test('computer plays white when you play black, board flipped', () => {
    const r = make({ prefs: { mode: 'computer', level: 'easy', human: 1 } }), g = r.g;
    g.input(knob(5)); g.input(press);
    assert.ok(g.flip && g.think);
    r.run(3000);
    assert.strictEqual(g.sans.length, 1);
    assert.strictEqual(look.hitSquare(g, look.LAYOUT.BX + 5, look.LAYOUT.BY + 5), E.sqOf('h1'), 'h1 top left when flipped');
});
test('a win against the computer scores its level', () => {
    const r = make(), g = r.g;
    g.input(knob(5)); g.input(press);
    g.b.setFen('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1');
    g.status = g.b.status();
    tapAt(g, 'a1'); tapAt(g, 'a8');
    r.run(500);
    assert.strictEqual(g.result.why, 'checkmate');
    assert.strictEqual(r.ended(), null, 'the final position shows first');
    draws(g);
    r.run(3000);
    assert.ok(r.ended() >= 100, 'scored ' + r.ended());
    assert.strictEqual(r.st.game, null, 'the saved game is cleared');
});
test('promotion: choose the piece by touch or with the knob', () => {
    const r = make({ prefs: { mode: 'friend', knobSide: 0 } }), g = r.g;
    g.input(knob(5)); g.input(press);
    g.b.setFen('8/P6k/8/8/8/8/7p/K7 w - - 0 1');
    g.status = g.b.status();
    knobTo(g, 'a7'); knobTo(g, 'a8');
    assert.ok(g.promo);
    draws(g);
    g.input(knob(1)); g.input(press);                    // Rook
    assert.strictEqual(g.sans[0], 'a8=R');
    r.run(400);
    tapAt(g, 'h2'); tapAt(g, 'h1');                      // black, on touch
    assert.ok(g.promo);
    const pr = look.promoHit(g, 0, 0);
    assert.strictEqual(pr, -1);
    // tap the knight (the 4th tile)
    const LB = look.LAYOUT, n = 4, tw = n * 92 + 3 * 12, x0 = LB.BX + (LB.BW - tw) / 2 + 3 * 104 + 40, y = LB.BY + LB.BW / 2 + 14;
    g.input({ type: 'touch', phase: 'down', x: x0, y }); g.input({ type: 'touch', phase: 'up', x: x0, y });
    assert.strictEqual(g.sans[1], 'h1=N');
});
test('two players: the knob plays one side, touch the other', () => {
    const r = make({ prefs: { mode: 'friend', knobSide: 1 } }), g = r.g;      // knob = black, touch = white
    g.input(knob(5)); g.input(press);
    assert.ok(!g.canMove('knob') && g.canMove('touch'));
    g.input(knob(1)); g.input(press);
    assert.strictEqual(g.b.ply, 0, 'the knob waits for its turn');
    tapAt(g, 'e2'); tapAt(g, 'e4');
    assert.strictEqual(g.b.ply, 1);
    r.run(400);
    assert.ok(g.canMove('knob') && !g.canMove('touch'));
    tapAt(g, 'e7'); tapAt(g, 'e5');
    assert.strictEqual(g.b.ply, 1, 'touch waits for its turn');
    knobTo(g, 'e7'); knobTo(g, 'e5');
    assert.strictEqual(g.sans.join(' '), 'e4 e5');
    r.run(400);
    // nobody calls end() in a two-player game; a resign shows the result and New game
    const b = look.buttonRects(g).find((q) => q.id === 'resign');
    g.input({ type: 'touch', phase: 'down', x: b.x + 5, y: b.y + 5 }); g.input({ type: 'touch', phase: 'up', x: b.x + 5, y: b.y + 5 });
    g.input({ type: 'touch', phase: 'down', x: b.x + 5, y: b.y + 5 }); g.input({ type: 'touch', phase: 'up', x: b.x + 5, y: b.y + 5 });
    assert.strictEqual(g.result.winner, 1, 'touch (white) resigned');
    r.run(5000);
    assert.strictEqual(r.ended(), null);
    assert.deepStrictEqual(g.buttons(), ['new']);
    draws(g);
    g.input(knob(1)); g.input(press);
    assert.strictEqual(g.state, 'setup', 'New game with the knob');
});
test('a game in progress is saved and can be continued', () => {
    const st = {};
    const r = make(st), g = r.g;
    g.input(knob(5)); g.input(press);
    tapAt(g, 'd2'); tapAt(g, 'd4');
    r.run(4000);
    assert.strictEqual(st.game.moves.length, 2);
    const r2 = make(st), g2 = r2.g;
    assert.strictEqual(g2.setupRows()[0], 'continue');
    draws(g2);
    g2.input(press);
    assert.strictEqual(g2.state, 'play');
    assert.strictEqual(g2.sans.length, 2);
    assert.strictEqual(g2.sans[0], 'd4');
});
test('a whole game, knob only, against easy (no hangs, ends)', () => {
    const r = make(), g = r.g;
    g.input(knob(5)); g.input(press);
    for (let i = 0; i < 400 && !g.result; i++) {
        if (g.canMove('knob')) {
            // turn a few clicks, press; turn, press: whatever lands
            const turn = (n) => { g.input(knob(n)); for (let k = 0; k < 40 && g.cursor.kind === 'btn'; k++) g.input(knob(1)); g.input(press); };
            turn(1 + (i % 3));
            turn(1 + (i % 2));
            if (g.promo) g.input(press);
        }
        r.run(700);
    }
    draws(g);
    assert.ok(g.b.ply > 20, 'moves were played (' + g.b.ply + ')');
});

console.log(failed ? failed + ' failed' : 'all passed');
process.exit(failed ? 1 : 0);
