'use strict';
/**
 * Chess in the shell's Night Circuit look (api.style): a glass board in the game's teal, ivory
 * white pieces and dark black ones with a lit rim, drawn from simple shapes (no images). Left: the
 * two players, whose move it is and the captured pieces. Right: the moves and the buttons, or the
 * setup before a game. Also the hit tests for touch, so the layout lives in one place.
 */
const E = require('./engine');

const W = 1600, H = 520;
const HUE = '#2ee6c8';
const Q = 56;                                  // a square
const BX = 576, BY = 56, BW = Q * 8;           // the board: x 576..1024, y 56..504
const LP = { x: 24, y: 56, w: 524, h: 448 };   // left panel
const RP = { x: 1052, y: 56, w: 524, h: 448 }; // right panel
const BTN = { y: RP.y + RP.h - 80, h: 60 };
const LAYOUT = { Q, BX, BY, BW, LP, RP };

/* ---------- where things are ---------- */
/** A square's place on the screen: col 0..7 left to right, row 0..7 top to bottom. */
function view(g, sq) {
    const f = sq & 7, r = sq >> 4;
    return g.flip ? { col: 7 - f, row: r } : { col: f, row: 7 - r };
}
function square(g, col, row) { return g.flip ? row * 16 + (7 - col) : (7 - row) * 16 + col; }
function sqXY(g, sq) { const v = view(g, sq); return { x: BX + v.col * Q, y: BY + v.row * Q }; }
function hitSquare(g, x, y) {
    if (x < BX || x >= BX + BW || y < BY || y >= BY + BW) return -1;
    return square(g, Math.floor((x - BX) / Q), Math.floor((y - BY) / Q));
}
function buttonRects(g) {
    const ids = g.state === 'play' ? g.buttons() : [];
    const gap = 16, w = (RP.w - 48 - gap * (ids.length - 1)) / Math.max(1, ids.length);
    return ids.map((id, i) => ({ id, x: RP.x + 24 + i * (w + gap), y: BTN.y, w, h: BTN.h }));
}
function buttonHit(g, x, y) {
    const r = buttonRects(g).find((b) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h);
    return r ? r.id : null;
}
const PROMO = { w: 92, gap: 12 };
function promoRects(g) {
    const n = 4, tw = n * PROMO.w + (n - 1) * PROMO.gap, x0 = BX + (BW - tw) / 2, y = BY + BW / 2 - PROMO.w / 2 + 14;
    const out = [];
    for (let i = 0; i < n; i++) out.push({ i, x: x0 + i * (PROMO.w + PROMO.gap), y, w: PROMO.w, h: PROMO.w });
    return out;
}
function promoHit(g, x, y) {
    const r = promoRects(g).find((b) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h);
    return r ? r.i : -1;
}
/** The setup rows: { row, x, y, w, h, opts: [{ x, w }] } */
const ROW_H = 72;
function setupRects(g) {
    const rows = g.setupRows(), out = [];
    const y0 = RP.y + 60;
    let y = y0;
    rows.forEach((row) => {
        const h = row === 'start' || row === 'continue' ? 62 : ROW_H;
        if (row === 'start') y = RP.y + RP.h - 24 - h;
        const r = { row, x: RP.x + 20, y, w: RP.w - 40, h, opts: [] };
        const ch = g.setupChoices(row);
        if (ch) {
            const ox = RP.x + 190, ow = RP.x + RP.w - 32 - ox, gap = 8, w = (ow - gap * (ch.opts.length - 1)) / ch.opts.length;
            ch.opts.forEach((o, i) => r.opts.push({ x: ox + i * (w + gap), w }));
        }
        out.push(r);
        y += h + (row === 'continue' ? 14 : 4);
    });
    return out;
}
function setupHit(g, x, y) {
    const r = setupRects(g).find((q) => x >= q.x && x < q.x + q.w && y >= q.y && y < q.y + q.h);
    if (!r) return null;
    const opt = r.opts.findIndex((o) => x >= o.x - 4 && x < o.x + o.w + 4);
    return { row: r.row, opt: r.opts.length ? opt : -1 };
}

/* ---------- the pieces: convex parts in a unit square (y down) ---------- */
const R = (x0, y0, x1, y1) => ({ p: [[x0, y1], [x1, y1], [x1, y0], [x0, y0]] });
const C = (x, y, r) => ({ c: [x, y, r] });
const BASE = [{ p: [[0.21, 0.87], [0.79, 0.87], [0.75, 0.78], [0.25, 0.78]] }, R(0.29, 0.73, 0.71, 0.79)];
const SHAPES = {};
SHAPES[E.PAWN] = BASE.concat([{ p: [[0.37, 0.74], [0.63, 0.74], [0.57, 0.55], [0.43, 0.55]] }, R(0.36, 0.52, 0.64, 0.58), C(0.5, 0.41, 0.135)]);
SHAPES[E.ROOK] = BASE.concat([{ p: [[0.33, 0.74], [0.67, 0.74], [0.64, 0.40], [0.36, 0.40]] }, R(0.28, 0.27, 0.72, 0.41),
    R(0.28, 0.16, 0.38, 0.28), R(0.45, 0.16, 0.55, 0.28), R(0.62, 0.16, 0.72, 0.28)]);
SHAPES[E.BISHOP] = BASE.concat([{ p: [[0.38, 0.74], [0.62, 0.74], [0.57, 0.58], [0.43, 0.58]] }, R(0.34, 0.55, 0.66, 0.61),
    { p: [[0.5, 0.18], [0.6, 0.27], [0.65, 0.38], [0.63, 0.48], [0.56, 0.56], [0.44, 0.56], [0.37, 0.48], [0.35, 0.38], [0.4, 0.27]] }, C(0.5, 0.15, 0.055)]);
SHAPES[E.KNIGHT] = BASE.concat([
    { p: [[0.3, 0.75], [0.72, 0.75], [0.69, 0.45], [0.4, 0.4]] },
    { p: [[0.4, 0.42], [0.69, 0.47], [0.66, 0.24], [0.47, 0.17]] },
    { p: [[0.46, 0.18], [0.54, 0.36], [0.28, 0.53], [0.18, 0.43]] },
    { p: [[0.5, 0.2], [0.62, 0.24], [0.6, 0.07], [0.6, 0.07]] },
]);
SHAPES[E.QUEEN] = BASE.concat([{ p: [[0.34, 0.74], [0.66, 0.74], [0.61, 0.52], [0.39, 0.52]] }, R(0.34, 0.49, 0.66, 0.55),
    { p: [[0.37, 0.5], [0.63, 0.5], [0.77, 0.25], [0.23, 0.25]] },
    C(0.23, 0.23, 0.05), C(0.365, 0.18, 0.05), C(0.5, 0.15, 0.055), C(0.635, 0.18, 0.05), C(0.77, 0.23, 0.05)]);
SHAPES[E.KING] = BASE.concat([{ p: [[0.34, 0.74], [0.66, 0.74], [0.61, 0.5], [0.39, 0.5]] }, R(0.34, 0.47, 0.66, 0.53),
    { p: [[0.36, 0.48], [0.64, 0.48], [0.71, 0.29], [0.29, 0.29]] }, R(0.31, 0.26, 0.69, 0.31),
    R(0.465, 0.07, 0.535, 0.27), R(0.39, 0.12, 0.61, 0.18)]);
// details drawn over the body: [kind, ...] lines in unit coords
const DETAIL = {};
DETAIL[E.BISHOP] = [[0.54, 0.3, 0.46, 0.41]];
DETAIL[E.KNIGHT] = [[0.66, 0.26, 0.7, 0.7]];

function polyFill(cv, pts, c) {
    for (let i = 1; i + 1 < pts.length; i += 2) {
        const d = pts[i + 2] || pts[i + 1];
        cv.quad([pts[0], pts[i], pts[i + 1], d], c);
    }
}
function grow(pts, e, s) {
    let cx = 0, cy = 0;
    pts.forEach((p) => { cx += p[0]; cy += p[1]; });
    cx /= pts.length; cy /= pts.length;
    return pts.map((p) => {
        const dx = p[0] - cx, dy = p[1] - cy, l = Math.sqrt(dx * dx + dy * dy) * s || 1;
        return [p[0] + dx / l * e / s, p[1] + dy / l * e / s];
    });
}
/**
 * One piece p (engine code) in a box at x, y of size s. k: 0..1 opacity. hue: the black pieces' rim.
 */
function drawPiece(cv, S, p, x, y, s, k, hue, lift) {
    const t = p & 7, black = (p & E.BLACK) !== 0, parts = SHAPES[t];
    if (!parts) return;
    k = k == null ? 1 : k;
    hue = hue || HUE;
    const fill = black ? '#161d36' : '#eef1f8', shade = black ? '#141a31' : '#c7cfe0';
    const rim = black ? S.a(hue, 0.95) : S.a('#04060c', 0.95), e = Math.max(1.6, s * 0.035);
    if (k < 1) cv.alpha(k);
    cv.roundRect(x + s * 0.2, y + s * (0.83 + (lift || 0) * 0.06), s * 0.6, s * 0.09, s * 0.045, [0, 0, 0, 110]);
    if (lift) y -= s * 0.06 * lift;
    const P = (q) => q.map((v) => [x + v[0] * s, y + v[1] * s]);
    // a halo behind the black pieces' rim so they read on the dark squares
    if (black) parts.forEach((q) => { if (q.c) cv.circle(x + q.c[0] * s, y + q.c[1] * s, q.c[2] * s + e * 2.2, S.a(hue, 0.16)); else polyFill(cv, grow(P(q.p), e * 2.2, 1), S.a(hue, 0.16)); });
    parts.forEach((q) => { if (q.c) cv.circle(x + q.c[0] * s, y + q.c[1] * s, q.c[2] * s + e, rim); else polyFill(cv, grow(P(q.p), e, 1), rim); });
    parts.forEach((q, i) => {
        const c = i < 2 ? shade : fill;
        if (q.c) cv.circle(x + q.c[0] * s, y + q.c[1] * s, q.c[2] * s, c);
        else polyFill(cv, P(q.p), c);
    });
    // a little light on the round parts and the details
    parts.forEach((q) => { if (q.c && q.c[2] > 0.1) cv.circle(x + (q.c[0] - q.c[2] * 0.35) * s, y + (q.c[1] - q.c[2] * 0.35) * s, q.c[2] * s * 0.3, black ? S.a(hue, 0.35) : [255, 255, 255, 200]); });
    (DETAIL[t] || []).forEach((l) => cv.line(x + l[0] * s, y + l[1] * s, x + l[2] * s, y + l[3] * s, Math.max(1.5, s * 0.035), black ? S.a(hue, 0.8) : '#7d8aa6'));
    if (t === E.KNIGHT) cv.circle(x + 0.47 * s, y + 0.29 * s, Math.max(1.5, s * 0.03), black ? hue : '#1d2643');
    if (k < 1) cv.alpha(1);
}

/* ---------- effects ---------- */
class Fx {
    constructor(S) {
        this.S = S;
        this.parts = new S.Particles(260);
        this.pops = new S.Popups();
        this.shake = new S.Shake();
        this.checkK = 0;
        this.overK = 0;
        this.selK = 0;
    }
    newGame() { this.overK = 0; this.checkK = 0; }
    moved(g, a) {
        const S = this.S, to = sqXY(g, a.capSq);
        if (a.captured) {
            this.parts.burst(to.x + Q / 2, to.y + Q / 2, a.captured & E.BLACK ? HUE : '#eef1f8', 22, { speed: 380, life: 520 });
            this.shake.kick(3);
        }
        if (g.status && g.status.check && !g.status.over) { this.checkK = 1; this.shake.kick(4); }
        if (E.mPromo(a.m)) this.pops.add('Promoted', to.x + Q / 2, to.y, S.P.gold, { size: 22 });
    }
    over(g, r) {
        const S = this.S, k = g.b.king[r.winner === -1 ? 0 : r.winner ^ 1], at = sqXY(g, k);
        this.overK = 0.001;
        if (r.why === 'checkmate') { this.shake.kick(10); this.parts.burst(at.x + Q / 2, at.y + Q / 2, S.P.bad, 50, { speed: 520, life: 900 }); }
        const win = r.winner !== -1 ? sqXY(g, g.b.king[r.winner]) : null;
        if (win) for (let i = 0; i < 3; i++) this.parts.burst(win.x + Q / 2, win.y + Q / 2, S.P.gold, 18, { speed: 300 + i * 120, life: 900 });
    }
    update(dt, g) {
        this.checkK = Math.max(0, this.checkK - dt / 900);
        if (this.overK > 0) this.overK = Math.min(1, this.overK + dt / 500);
        this.selK = this.S.approach(this.selK, g.sel >= 0 ? 1 : 0, dt, 0.7);
        this.parts.update(dt); this.pops.update(dt); this.shake.update(dt);
    }
}

/* ---------- the picture ---------- */
function draw(cv, g, S) {
    const P = S.P, ms = g.t;
    S.backdrop(cv, 0, 44, W, H - 44, { tint: HUE, grid: 48, horizon: 0.5 });
    drawBoard(cv, g, S, ms);
    drawLeft(cv, g, S, ms);
    if (g.state === 'setup') drawSetup(cv, g, S, ms); else drawRight(cv, g, S, ms);
    if (g.flash) {
        const f = g.flash.t, k = Math.min(1, f / 120) * Math.min(1, (1600 - f) / 300);
        cv.alpha(Math.max(0, k));
        S.chip(cv, g.flash.s, BX + BW / 2, BY + BW - 52, P.warn, { align: 'center', solid: true, size: 15 });
        cv.alpha(1);
    }
}

function drawBoard(cv, g, S, ms) {
    const P = S.P, b = g.b, fx = g.fx, ox = fx.shake.x, oy = fx.shake.y;
    const setup = g.state === 'setup';
    S.panel(cv, BX - 12 + ox, BY - 12 + oy, BW + 24, BW + 24, { r: 14, accent: HUE, glow: 0.35, bar: false });
    const light = S.mix(HUE, '#3a4766', 0.9), dark = '#111a2f';
    for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
        const x = BX + col * Q + ox, y = BY + row * Q + oy;
        cv.fillRect(x, y, Q, Q, (row + col) & 1 ? dark : light);
    }
    cv.fillRect(BX + ox, BY + oy, BW, 1, S.a('#ffffff', 0.12));
    // coordinates, small, in the corner squares
    for (let i = 0; i < 8; i++) {
        const f = g.flip ? 7 - i : i, r = g.flip ? i : 7 - i;
        cv.text('abcdefgh'[f], BX + i * Q + Q - 6 + ox, BY + BW - 5 + oy, 13, S.a(P.ink, 0.35), { font: 'bold', align: 'right' });
        cv.text(String(r + 1), BX + 4 + ox, BY + i * Q + 15 + oy, 13, S.a(P.ink, 0.35), { font: 'bold' });
    }
    const at = (sq) => { const p = sqXY(g, sq); return { x: p.x + ox, y: p.y + oy }; };
    // the last move
    const last = b.lastMove();
    if (last && !setup) [E.mFrom(last), E.mTo(last)].forEach((s) => { const p = at(s); cv.fillRect(p.x, p.y, Q, Q, S.a(HUE, 0.22)); });
    // check
    if (!setup && g.status.check) {
        const p = at(b.king[b.side]), k = 0.6 + 0.4 * S.ease.pulse(ms, 900);
        S.halo(cv, p.x + Q / 2, p.y + Q / 2, Q * 0.9, P.bad, 3 * k);
        cv.strokeRoundRect(p.x + 2, p.y + 2, Q - 4, Q - 4, 6, 2.5, S.a(P.bad, 0.9 * k));
    }
    // the picked-up piece and where it can go
    if (g.sel >= 0 && !setup) {
        const p = at(g.sel);
        cv.fillRect(p.x, p.y, Q, Q, S.a(HUE, 0.35 * fx.selK));
        g.movesFrom(g.sel).forEach((m) => {
            const t = at(E.mTo(m)), cx = t.x + Q / 2, cy = t.y + Q / 2;
            if (b.sq[E.mTo(m)] || (E.mFlags(m) & E.F_EP)) cv.arc(cx, cy, Q * 0.38, Q * 0.46, 0, 360, S.a(HUE, 0.8));
            else { cv.circle(cx, cy, Q * 0.2, S.a(HUE, 0.12)); cv.circle(cx, cy, Q * 0.11, S.a(HUE, 0.85)); }
        });
    }
    // the pieces (the moving one, the dragged one and a fading capture apart)
    const a = g.anim, drag = g.drag && g.drag.moved ? g.drag : null;
    const skip = {};
    if (a) { skip[a.to] = 1; if (a.castle) skip[rookTo(a)] = 1; }
    if (drag) skip[drag.from] = 1;
    for (let s = 0; s < 128; s++) {
        if (s & 0x88) { s += 7; continue; }
        const p = b.sq[s];
        if (!p || skip[s]) continue;
        const q = at(s);
        drawPiece(cv, S, p, q.x, q.y, Q, setup ? 0.55 : 1, HUE, s === g.sel ? fx.selK : 0);
    }
    if (a) {
        const k = S.ease.out(a.t / 220);
        if (a.captured) { const c = at(a.capSq); drawPiece(cv, S, a.captured, c.x, c.y, Q, 1 - k, HUE); }
        const f = at(a.from), t = at(a.to);
        if (a.castle) {
            const rf = at(rookFrom(a)), rt = at(rookTo(a));
            drawPiece(cv, S, b.sq[rookTo(a)], rf.x + (rt.x - rf.x) * k, rf.y + (rt.y - rf.y) * k, Q, 1, HUE);
        }
        const piece = b.sq[a.to] || a.piece;
        drawPiece(cv, S, piece, f.x + (t.x - f.x) * k, f.y + (t.y - f.y) * k, Q, 1, HUE, 1 - k);
    }
    // the knob's cursor
    const knobOn = !setup && g.cursor.kind === 'sq' && !g.promo && (g.canMove('knob') || (g.mode === 'friend' && false));
    if (knobOn) {
        const p = at(g.cursor.sq), k = 0.65 + 0.35 * S.ease.pulse(ms, 1100);
        S.glowRect(cv, p.x + 3, p.y + 3, Q - 6, Q - 6, 8, HUE, 0.5 * k);
        cv.strokeRoundRect(p.x + 3, p.y + 3, Q - 6, Q - 6, 8, 3, S.a(S.lighten(HUE, 0.3), k));
    }
    if (drag) drawPiece(cv, S, b.sq[drag.from], drag.x - Q * 0.6, drag.y - Q * 0.75, Q * 1.2, 1, HUE, 1);
    fx.parts.draw(cv, 0, 0);
    fx.pops.draw(cv, 0, 0);
    if (g.promo) drawPromo(cv, g, S, ms);
    if (g.result) drawBanner(cv, g, S, ms);
}
function rookFrom(a) { return a.to > a.from ? a.from + 3 : a.from - 4; }
function rookTo(a) { return a.to > a.from ? a.from + 1 : a.from - 1; }

function drawPromo(cv, g, S, ms) {
    const P = S.P, side = g.b.side ? E.BLACK : 0, types = [E.QUEEN, E.ROOK, E.BISHOP, E.KNIGHT];
    cv.fillRect(BX, BY, BW, BW, [3, 5, 12, 170]);
    const rs = promoRects(g);
    S.label(cv, 'Promote to', BX + BW / 2, rs[0].y - 18, P.ink, { align: 'center', size: 15 });
    rs.forEach((r, i) => {
        const on = g.promo.i === i && g.cursor.kind === 'promo';
        S.panel(cv, r.x, r.y, r.w, r.h, { r: 12, accent: HUE, glow: on ? 0.8 : 0, bar: false });
        drawPiece(cv, S, types[i] | side, r.x + 8, r.y + 6, r.w - 16, 1, HUE);
    });
}

function resultText(g) {
    const r = g.result, side = (s) => (s ? 'Black' : 'White');
    let head, sub;
    if (r.winner === -1) {
        head = 'Draw';
        sub = { stalemate: 'Stalemate', fifty: '50 moves without a capture or a pawn move', repetition: 'The same position three times', material: 'Not enough pieces left to mate' }[r.why] || '';
    } else if (g.mode === 'computer') {
        head = r.winner === g.human ? 'You win' : 'The computer wins';
        sub = r.why === 'resign' ? 'You resigned' : 'Checkmate';
    } else {
        head = side(r.winner) + ' wins';
        sub = r.why === 'resign' ? side(r.winner ^ 1) + ' resigned' : 'Checkmate';
    }
    return { head, sub };
}
function drawBanner(cv, g, S, ms) {
    const P = S.P, k = S.ease.out(g.fx.overK), rt = resultText(g);
    if (k <= 0) return;
    cv.alpha(k);
    const w = 380, h = 112, x = BX + (BW - w) / 2, y = BY + (BW - h) / 2;
    S.panel(cv, x, y, w, h, { r: 18, accent: g.result.winner === -1 ? P.cold : P.gold, glow: 0.7, barW: 80 });
    cv.text(rt.head, x + w / 2, y + 56, 34, P.ink, { align: 'center', font: 'bold' });
    cv.text(rt.sub, x + w / 2, y + 88, 17, P.dim, { align: 'center', font: 'label' });
    cv.alpha(1);
}

/* ---------- the left panel: the players ---------- */
function playerName(g, side) {
    if (g.state === 'setup') return side ? 'Black' : 'White';
    if (g.mode === 'computer') return side === g.human ? 'You' : 'Computer';
    return side ? 'Black' : 'White';
}
function playerTag(g, side) {
    if (g.state === 'setup') return '';
    if (g.mode === 'computer') return side === g.human ? 'Knob or touch' : g.level.name;
    return side === g.knobSide ? 'Knob' : 'Touch';
}
/** The pieces a side has taken, and its material lead. */
function captures(b) {
    const START = [0, 8, 2, 2, 2, 1, 1], left = [[0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0]];
    for (let s = 0; s < 128; s++) { if (s & 0x88) { s += 7; continue; } const p = b.sq[s]; if (p) left[E.colorOf(p)][p & 7]++; }
    const VAL = [0, 1, 3, 3, 5, 9, 0], took = [[], []], mat = [0, 0];
    for (let side = 0; side < 2; side++) {
        const them = side ^ 1;
        for (let t = E.QUEEN; t >= E.PAWN; t--) {
            const n = Math.max(0, START[t] - left[them][t]);
            for (let i = 0; i < n; i++) took[side].push(t | (them ? E.BLACK : 0));
        }
        for (let t = 1; t <= 5; t++) mat[side] += left[side][t] * VAL[t];
    }
    return { took, lead: [mat[0] - mat[1], mat[1] - mat[0]] };
}
function drawLeft(cv, g, S, ms) {
    const P = S.P, b = g.b, x = LP.x, w = LP.w;
    S.panel(cv, x, LP.y, w, LP.h, { r: 18, accent: HUE, barW: 72 });
    if (g.state === 'setup') {
        S.label(cv, 'Chess', x + 28, LP.y + 44, HUE, { size: 15 });
        cv.text('A new game', x + 28, LP.y + 96, 36, P.ink, { font: 'bold' });
        const lines = g.prefs.mode === 'friend'
            ? ['Two players in the car: one plays with', 'the iDrive knob, the other on the screen.', 'Choose the side the knob plays.']
            : ['Play the computer, Easy to Hard.', 'A win scores its level, more when quick.', 'The game is saved after every move.'];
        lines.forEach((s, i) => cv.text(s, x + 28, LP.y + 148 + i * 30, 19, P.dim, { font: 'label' }));
        S.label(cv, 'Knob', x + 28, LP.y + 286, P.faint, { size: 13 });
        cv.text('Turn: choose a piece    Press: pick it up', x + 28, LP.y + 312, 17, P.dim, { font: 'label' });
        cv.text('Turn: choose its square    Press: play', x + 28, LP.y + 338, 17, P.dim, { font: 'label' });
        S.label(cv, 'Touch', x + 28, LP.y + 378, P.faint, { size: 13 });
        cv.text('Tap a piece, then its square, or drag it', x + 28, LP.y + 404, 17, P.dim, { font: 'label' });
        return;
    }
    const cap = captures(b);
    const top = g.flip ? 0 : 1, bottom = top ^ 1;
    playerRow(cv, g, S, top, LP.y + 18, cap, ms);
    playerRow(cv, g, S, bottom, LP.y + LP.h - 18 - 96, cap, ms);
    // the middle: whose move, check, thinking, or the result
    const my = LP.y + LP.h / 2;
    let head, sub, col = P.ink;
    if (g.result) { const rt = resultText(g); head = rt.head; sub = rt.sub; col = g.result.winner === -1 ? P.cold : P.gold; } else if (g.think) {
        const dots = '...'.slice(0, 1 + Math.floor(ms / 300) % 3);
        head = 'Thinking' + dots; sub = g.level.name + ' level'; col = HUE;
    } else {
        const who = g.mode === 'computer' ? 'Your move' : (b.side ? 'Black' : 'White') + ' to move';
        head = g.status.check ? 'Check!' : who;
        col = g.status.check ? P.bad : P.ink;
        if (g.mode === 'friend') sub = (b.side ? 'Black' : 'White') + ' plays ' + (g.sideOf('knob') === b.side ? 'with the knob' : 'on the screen');
        else sub = g.sel >= 0 ? 'Now choose its square' : 'Turn the knob or tap a piece';
        if (g.status.check) sub = (g.mode === 'computer' ? 'Your' : (b.side ? 'Black\'s' : 'White\'s')) + ' king is attacked';
    }
    cv.text(head, x + 28, my + 6, 34, col, { font: 'bold' });
    if (sub) cv.text(sub, x + 28, my + 36, 17, P.dim, { font: 'label' });
}
function playerRow(cv, g, S, side, y, cap, ms) {
    const P = S.P, x = LP.x + 16, w = LP.w - 32, h = 96, b = g.b;
    const on = !g.result && b.side === side;
    if (on) {
        cv.roundRect(x, y, w, h, 14, S.a(HUE, 0.10 + 0.04 * S.ease.pulse(ms, 1400)));
        cv.roundRect(x, y + 14, 4, h - 28, 2, HUE);
    }
    drawPiece(cv, S, E.KING | (side ? E.BLACK : 0), x + 10, y + 12, 64, 1, HUE);
    cv.text(playerName(g, side), x + 86, y + 42, 26, on ? P.ink : P.dim, { font: 'bold' });
    const tag = playerTag(g, side);
    if (tag) S.chip(cv, tag, x + w - 12, y + 18, on ? HUE : P.faint, { align: 'right', size: 13 });
    // the pieces it took, small
    const took = cap.took[side];
    let cx = x + 86;
    took.forEach((p, i) => {
        if (cx > x + w - 70) return;
        drawPiece(cv, S, p, cx, y + 52, 30, 0.9, HUE);
        cx += i + 1 < took.length && (took[i + 1] & 7) === (p & 7) ? 15 : 24;
    });
    if (cap.lead[side] > 0) cv.text('+' + cap.lead[side], cx + 10, y + 78, 18, HUE, { font: 'bold' });
}

/* ---------- the right panel: the moves and the buttons ---------- */
function drawRight(cv, g, S, ms) {
    const P = S.P, x = RP.x, w = RP.w;
    S.panel(cv, x, RP.y, w, RP.h, { r: 18 });
    S.label(cv, 'Moves', x + 28, RP.y + 40, P.dim, { size: 15 });
    const sans = g.sans, rows = Math.ceil(sans.length / 2), show = 7;
    const r0 = Math.max(0, rows - show);
    for (let r = r0; r < rows; r++) {
        const y = RP.y + 76 + (r - r0) * 36;
        const lastRow = r === rows - 1;
        if (lastRow) cv.roundRect(x + 16, y - 25, w - 32, 34, 8, S.a(HUE, 0.10));
        cv.text((r + 1) + '.', x + 64, y, 19, P.faint, { font: 'bold', align: 'right' });
        const a = sans[r * 2], bb = sans[r * 2 + 1];
        const lastI = sans.length - 1;
        if (a) cv.text(a, x + 84, y, 21, r * 2 === lastI ? HUE : P.ink, { font: 'bold' });
        if (bb) cv.text(bb, x + 230, y, 21, r * 2 + 1 === lastI ? HUE : P.ink, { font: 'bold' });
    }
    if (!sans.length) cv.text(g.b.side === 0 ? 'White moves first' : '', x + 28, RP.y + 80, 19, P.faint, { font: 'label' });
    buttonRects(g).forEach((r) => {
        const on = g.cursor.kind === 'btn' && g.cursor.id === r.id;
        const sure = r.id === 'resign' && g.confirm;
        const label = { undo: 'Take back', resign: sure ? 'Sure? Resign' : 'Resign', new: 'New game' }[r.id];
        const col = sure ? P.bad : HUE;
        S.panel(cv, r.x, r.y, r.w, r.h, { r: 14, accent: col, glow: on ? 0.8 : 0, bar: false, fill: on ? [[0, S.mix(col, '#182038', 0.75)], [1, S.mix(col, '#0d1222', 0.85)]] : null });
        cv.text(label, r.x + r.w / 2, r.y + r.h / 2 + 8, 22, on || sure ? P.ink : P.dim, { align: 'center', font: 'bold' });
    });
    if (!buttonRects(g).length && g.result) cv.text('The result comes next', x + w / 2, BTN.y + 38, 18, P.faint, { align: 'center', font: 'label' });
}

function drawSetup(cv, g, S, ms) {
    const P = S.P, x = RP.x, w = RP.w;
    S.panel(cv, x, RP.y, w, RP.h, { r: 18, accent: HUE, barW: 72 });
    S.label(cv, 'Set up', x + 28, RP.y + 40, P.dim, { size: 15 });
    const rows = g.setupRows();
    setupRects(g).forEach((r, i) => {
        const on = rows[g.setupRow] === r.row;
        if (r.row === 'start' || r.row === 'continue') {
            const col = r.row === 'start' ? HUE : P.gold;
            S.panel(cv, r.x, r.y, r.w, r.h, { r: 14, accent: col, glow: on ? 0.9 : 0, bar: false, fill: on ? [[0, S.mix(col, '#182038', 0.7)], [1, S.mix(col, '#0d1222', 0.82)]] : null });
            const s = r.row === 'start' ? 'Start' : 'Continue the saved game';
            cv.text(s, r.x + r.w / 2, r.y + r.h / 2 + 9, 24, on ? P.ink : P.dim, { align: 'center', font: 'bold' });
            if (r.row === 'continue' && g.saved) {
                const n = Math.ceil(g.saved.moves.length / 2);
                S.chip(cv, (g.saved.mode === 'friend' ? '2 players' : 'Computer') + ', move ' + Math.max(1, n), r.x + r.w - 12, r.y - 14, P.gold, { align: 'right', size: 12 });
            }
            return;
        }
        const ch = g.setupChoices(r.row);
        if (on) cv.roundRect(r.x, r.y + 6, r.w, r.h - 12, 12, S.a(HUE, 0.10));
        if (on) cv.roundRect(r.x, r.y + 18, 4, r.h - 36, 2, HUE);
        cv.text(ch.label, r.x + 18, r.y + r.h / 2 + 7, 20, on ? P.ink : P.dim, { font: 'bold' });
        ch.opts.forEach((o, j) => {
            const ox = r.opts[j].x, ow = r.opts[j].w, sel = j === ch.i, oy = r.y + 16, oh = r.h - 32;
            if (sel) { if (on) S.glowRect(cv, ox, oy, ow, oh, oh / 2, HUE, 0.5); cv.roundRect(ox, oy, ow, oh, oh / 2, on ? HUE : S.a(HUE, 0.5)); } else cv.strokeRoundRect(ox, oy, ow, oh, oh / 2, 1.2, P.hair);
            cv.text(o, ox + ow / 2, oy + oh / 2 + 6, 17, sel ? P.bg0 : P.dim, { align: 'center', font: 'bold' });
        });
        if (ch.note) cv.text(ch.note, r.opts[0].x, r.y + r.h + 6, 14, P.faint, { font: 'label' });
    });
    if (!rows.length) return;
    const hint = 'Turn: choose a row    Press: change it    Start: press or tap';
    cv.text(hint, x + w / 2, RP.y + RP.h - 104, 15, P.faint, { align: 'center', font: 'label' });
}

/* ---------- the menu tile ---------- */
function art(cv, x, y, w, h, S, ms) {
    const n = 4, q = Math.min(w, h) / n;
    const light = S.mix(HUE, '#3a4766', 0.9), dark = '#111a2f';
    const ox = x + (w - q * n) / 2, oy = y + (h - q * n) / 2;
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) cv.fillRect(ox + c * q, oy + r * q, q, q, (r + c) & 1 ? dark : light);
    cv.fillRect(ox + q, oy + 2 * q, q, q, S.a(HUE, 0.3));
    const bob = Math.sin(ms / 700) * q * 0.04;
    drawPiece(cv, S, E.KING | E.BLACK, ox + 2 * q - q * 0.1, oy + q * 0.6, q * 1.25, 1, HUE);
    drawPiece(cv, S, E.KNIGHT, ox + q * 0.6, oy + 1.8 * q + bob, q * 1.3, 1, HUE, 0.4 + 0.3 * Math.sin(ms / 700));
    drawPiece(cv, S, E.PAWN, ox + 2.6 * q, oy + 2.5 * q, q * 0.9, 1, HUE);
    S.halo(cv, ox + 2.6 * q, oy + 1.2 * q, q * 1.2, HUE, 0.6);
}

module.exports = { LAYOUT, HUE, view, square, sqXY, hitSquare, buttonHit, buttonRects, promoHit, setupHit, setupRects, drawPiece, Fx, draw, art };
