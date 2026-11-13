'use strict';
/**
 * Paddle Duel in the shell's Night Circuit look (api.style). Reads the PaddleDuel state (game.js)
 * and draws it; Fx holds the effects the match's events start (sparks, shake, popups).
 */
const { W, COURT, PADDLE, BALL_R } = require('./game');

const MID = (COURT.top + COURT.bottom) / 2;
const HUE = '#9d7bff';

class Fx {
    constructor(S) {
        this.S = S;
        this.parts = new S.Particles(260);
        this.pops = new S.Popups();
        this.shake = new S.Shake();
        this.ring = 0;              // bumper ring wave 0..1
        this.lit = { L: 0, R: 0 };  // paddle hit glow
        this.wash = { L: 0, R: 0 }; // a point scored: that half lights
    }
    colors() { const P = this.S.P; return { L: P.cold, R: '#ffb547' }; }
    event(e, g) {
        const S = this.S, c = this.colors(), b = g.ball;
        if (e[0] === 'hit') {
            const side = e[1];
            this.lit[side] = 1;
            this.parts.burst(b.x, b.y, b.hot ? S.P.bad : c[side], b.hot ? 26 : 14, { dir: side === 'L' ? 0 : 180, spread: 110, speed: 520, life: 420 });
            this.shake.kick(b.hot ? 7 : 2.5);
            if (g.rally > 2 && g.rally % 5 === 0) this.pops.add(String(g.rally), W / 2, MID - 40, HUE, { size: 56 });
        } else if (e[0] === 'point' || e[0] === 'over') {
            const side = e[1], out = side === 'L' ? W - 20 : 20;
            this.wash[side] = 1;
            this.parts.burst(out, Math.max(COURT.top + 20, Math.min(COURT.bottom - 20, b.y)), c[side === 'L' ? 'R' : 'L'], 40, { dir: side === 'L' ? 180 : 0, spread: 120, speed: 800, life: 700 });
            this.shake.kick(12);
            this.pops.add('Point', side === 'L' ? W * 0.25 : W * 0.75, MID + 10, c[side], { size: 40, life: 1100 });
        } else if (e[0] === 'bumper') {
            this.ring = 1; this.shake.kick(4);
            this.parts.burst(b.x, b.y, HUE, 16, { speed: 420, life: 380 });
        }
    }
    update(dt) {
        this.parts.update(dt); this.pops.update(dt); this.shake.update(dt);
        this.ring = Math.max(0, this.ring - dt / 450);
        ['L', 'R'].forEach((s) => { this.lit[s] = Math.max(0, this.lit[s] - dt / 300); this.wash[s] = Math.max(0, this.wash[s] - dt / 900); });
    }
}

function draw(cv, g, S, fx) {
    const P = S.P, col = fx.colors(), ox = fx.shake.x, oy = fx.shake.y, ms = g.t * 1000;
    S.backdrop(cv, 0, 44, W, 520 - 44, { tint: HUE, grid: 40, sy: -ms * 0.01 });
    // the two halves, each faintly in its player's colour; a scored point lights the scorer's half
    cv.rampRect(0, COURT.top, W / 2, COURT.bottom - COURT.top, 0, [S.a(col.L, 0.10 + 0.25 * fx.wash.L), S.a(col.L, 0)]);
    cv.rampRect(W / 2, COURT.top, W / 2, COURT.bottom - COURT.top, 0, [S.a(col.R, 0), S.a(col.R, 0.10 + 0.25 * fx.wash.R)]);
    // walls, centre line, centre ring
    S.glowLine(cv, 0, COURT.top + oy, W, COURT.top + oy, 3, HUE, 0.8);
    S.glowLine(cv, 0, COURT.bottom + oy, W, COURT.bottom + oy, 3, HUE, 0.8);
    for (let y = COURT.top + 14; y < COURT.bottom - 14; y += 32) cv.line(W / 2 + ox, y + oy, W / 2 + ox, y + 14 + oy, 3, S.a(HUE, 0.45));
    cv.arc(W / 2 + ox, MID + oy, 84, 87, 0, 360, S.a(HUE, 0.25));
    // bumper: a lit ring that pulses when hit
    if (g.bumperOn) {
        const by = g.bumperY + oy, bx = W / 2 + ox, r = 28;
        if (fx.ring > 0) cv.arc(bx, by, r + 6 + 40 * (1 - fx.ring), r + 9 + 40 * (1 - fx.ring), 0, 360, S.a(HUE, fx.ring * 0.8));
        S.halo(cv, bx, by, r * 2.6, HUE, 1 + 2 * g.bumperFlash);
        cv.circle(bx, by, r, P.bg1);
        cv.arc(bx, by, r - 5, r, 0, 360, S.lighten(HUE, 0.2 * g.bumperFlash));
        cv.circle(bx, by, 6, S.a(HUE, 0.8));
    }
    // paddles
    ['L', 'R'].forEach((s) => {
        const p = g[s], x = p.x - PADDLE.w / 2 + ox, y = p.y - PADDLE.h / 2 + oy;
        S.block(cv, x, y, PADDLE.w, PADDLE.h, 8, col[s], 0.6 + 0.8 * fx.lit[s]);
        if (fx.lit[s] > 0) cv.roundRect(x - 2, y - 2, PADDLE.w + 4, PADDLE.h + 4, 9, S.a('#ffffff', 0.5 * fx.lit[s]));
    });
    // ball with a light trail (red-hot every few hits)
    const b = g.ball;
    if (g.state === 'play' || g.state === 'serve') {
        const bc = b.hot ? P.bad : '#ffffff';
        for (let i = 1; i < g.trail.length; i++) {
            const a = g.trail[i - 1], c = g.trail[i], k = i / g.trail.length;
            cv.line(a[0] + ox, a[1] + oy, c[0] + ox, c[1] + oy, BALL_R * 2 * k, S.a(b.hot ? P.bad : HUE, 0.35 * k));
        }
        const blink = g.state === 'serve' && Math.floor(g.timer * 6) % 2 === 1;
        if (!blink) S.glowCircle(cv, b.x + ox, b.y + oy, BALL_R, bc, b.hot ? 1.6 : 1);
    }
    fx.parts.draw(cv, ox, oy);
    fx.pops.draw(cv, ox, oy);
    hud(cv, g, S, col);
}

function hud(cv, g, S, col) {
    const P = S.P, y = 92;
    // names as chips at the sides, the score big in the middle
    S.chip(cv, g.label('L'), 24, 54, col.L, { size: 14 });
    S.chip(cv, g.label('R'), W - 24, 54, col.R, { size: 14, align: 'right' });
    cv.text(String(g.L.score), W / 2 - 64, y + 4, 64, S.a(col.L, 0.3), { font: 'num', align: 'center' });
    cv.text(String(g.L.score), W / 2 - 64, y + 2, 64, P.ink, { font: 'num', align: 'center' });
    cv.text(String(g.R.score), W / 2 + 64, y + 4, 64, S.a(col.R, 0.3), { font: 'num', align: 'center' });
    cv.text(String(g.R.score), W / 2 + 64, y + 2, 64, P.ink, { font: 'num', align: 'center' });
    cv.circle(W / 2, y - 30, 4, P.dim); cv.circle(W / 2, y - 14, 4, P.dim);
    // pips: points to win, filled as they come
    const n = g.o.target;
    for (let i = 0; i < n; i++) {
        cv.circle(W / 2 - 120 - i * 16, y - 20, 5, i < g.L.score ? col.L : S.a(P.faint, 0.8));
        cv.circle(W / 2 + 120 + i * 16, y - 20, 5, i < g.R.score ? col.R : S.a(P.faint, 0.8));
    }
    if (g.rally > 1 && g.state === 'play') S.stat(cv, 'Rally', g.rally, W / 2 + 330, y, { size: 32, color: g.ball.hot ? P.bad : HUE });
    else S.label(cv, 'First to ' + n, W / 2 + 330, y - 8, P.dim, { size: 15 });
    if (g.longest > 1) S.stat(cv, 'Best rally', g.longest, W / 2 - 330, y, { size: 32, color: P.dim, align: 'right' });
    if (g.hint && g.hits === 0 && g.L.score + g.R.score === 0) S.label(cv, g.hint, W / 2, COURT.bottom - 18, P.dim, { size: 14, align: 'center' });
}

/** The menu tile: two paddles and a ball crossing between them */
function art(cv, x, y, w, h, S, ms) {
    const P = S.P, cy = y + h / 2, t = ms / 1000;
    const span = w - 60, ph = (t * 0.7) % 2, k = ph < 1 ? ph : 2 - ph;
    const bx = x + 30 + span * k, by = cy + Math.sin(t * 2.3) * h * 0.25;
    for (let yy = y + 10; yy < y + h - 10; yy += 18) cv.line(x + w / 2, yy, x + w / 2, yy + 8, 2, S.a(HUE, 0.4));
    S.block(cv, x + 14, by - 28 + Math.sin(t * 2.3 - 0.4) * 8, 10, 56, 4, P.cold, 0.6);
    S.block(cv, x + w - 24, by - 28 - Math.sin(t * 2.3 + 0.5) * 8, 10, 56, 4, '#ffb547', 0.6);
    S.glowCircle(cv, bx, by, 8, '#ffffff', 1);
}

/* ---------- the setup card (index.js Game: rows(), choices(row), row) ---------- */
const SP = { x: W / 2 - 380, y: 128, w: 760, h: 378 };
const ROW_H = 68;
/** the setup rows: { row, x, y, w, h, opts: [{ x, w }] }; Start at the card's bottom */
function setupRects(game) {
    let y = SP.y + 52;
    return game.rows().map((row) => {
        const start = row === 'start', h = start ? 60 : ROW_H;
        const r = { row, x: SP.x + 20, y: start ? SP.y + SP.h - 20 - h : y, w: SP.w - 40, h, opts: [] };
        const ch = game.choices(row);
        if (ch) {
            const ox = SP.x + 230, ow = SP.x + SP.w - 36 - ox, gap = 10, w = (ow - gap * (ch.opts.length - 1)) / ch.opts.length;
            ch.opts.forEach((o, i) => r.opts.push({ x: ox + i * (w + gap), w }));
        }
        y += h + 4;
        return r;
    });
}
function setupHit(game, x, y) {
    const r = setupRects(game).find((q) => x >= q.x && x < q.x + q.w && y >= q.y && y < q.y + q.h);
    if (!r) return null;
    return { row: r.row, opt: r.opts.length ? r.opts.findIndex((o) => x >= o.x - 5 && x < o.x + o.w + 5) : -1 };
}
function drawSetup(cv, game, S) {
    const P = S.P, rows = game.rows();
    cv.fillRect(0, 44, W, 520 - 44, [3, 5, 12, 150]);
    S.panel(cv, SP.x, SP.y, SP.w, SP.h, { r: 20, accent: HUE, glow: 0.5, barW: 80 });
    S.label(cv, 'Set up the match', SP.x + 28, SP.y + 36, P.dim, { size: 15 });
    S.label(cv, 'Turn: a row   ·   press: change it   ·   or tap', SP.x + SP.w - 28, SP.y + 36, P.faint, { size: 13, align: 'right' });
    setupRects(game).forEach((r) => {
        const on = rows[game.row] === r.row;
        if (r.row === 'start') {
            S.panel(cv, r.x, r.y, r.w, r.h, { r: 14, accent: HUE, glow: on ? 0.9 : 0, bar: false, fill: on ? [[0, S.mix(HUE, '#182038', 0.7)], [1, S.mix(HUE, '#0d1222', 0.82)]] : null });
            cv.text('Start', r.x + r.w / 2, r.y + r.h / 2 + 9, 26, on ? P.ink : P.dim, { align: 'center', font: 'bold' });
            return;
        }
        const ch = game.choices(r.row);
        if (on) { cv.roundRect(r.x, r.y + 6, r.w, r.h - 12, 12, S.a(HUE, 0.10)); cv.roundRect(r.x, r.y + 18, 4, r.h - 36, 2, HUE); }
        cv.text(ch.label, r.x + 18, r.y + r.h / 2 + 7, 21, on ? P.ink : P.dim, { font: 'bold' });
        ch.opts.forEach((o, j) => {
            const ox = r.opts[j].x, ow = r.opts[j].w, sel = j === ch.i, oy = r.y + 14, oh = r.h - 28;
            if (sel) { if (on) S.glowRect(cv, ox, oy, ow, oh, oh / 2, HUE, 0.5); cv.roundRect(ox, oy, ow, oh, oh / 2, on ? HUE : S.a(HUE, 0.5)); } else cv.strokeRoundRect(ox, oy, ow, oh, oh / 2, 1.2, P.hair);
            cv.text(o, ox + ow / 2, oy + oh / 2 + 6, 18, sel ? P.bg0 : P.dim, { align: 'center', font: 'bold' });
        });
        if (ch.note) cv.text(ch.note, r.x + 18, r.y + r.h - 4, 13, P.faint, { font: 'label' });
    });
}

module.exports = { Fx, draw, art, HUE, setupRects, setupHit, drawSetup };
