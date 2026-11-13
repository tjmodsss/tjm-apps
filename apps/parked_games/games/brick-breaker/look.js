'use strict';
/**
 * Brick Breaker in the shell's Night Circuit look (api.style): glassy lit bricks, a glowing paddle
 * and ball with a light trail, shards when a brick breaks, popups, shake. Drawn on the whole
 * 1600 x 520 page (the field from y 100). Fx turns the engine's events into effects.
 */
const E = require('./engine');

const W = 1600, H = 520, HUD = 100;
const HUE = '#ff4fa8';
const CX = Math.round((E.PADDLE_X + E.PADDLE_T + E.BRICK_X0) / 2);
const POWER_LABEL = { wide: 'W', multi: 'M', slow: 'S', life: '+' };
const POWER_NAME = { wide: 'Wide paddle', multi: 'Multi-ball', slow: 'Slow ball', life: 'Extra life' };

function palette(S) {
    const P = S.P;
    return {
        hp: { 1: '#2ee6b8', 2: P.warn, 3: HUE }, steel: '#7d8aa3', bonus: '#a77bff', paddle: P.cold,
        power: { wide: P.cold, multi: P.gold, slow: P.good, life: HUE },
    };
}
const brickColor = (C, k) => (k.steel ? C.steel : k.bonus ? C.bonus : C.hp[Math.max(1, Math.min(3, k.hp))]);

class Fx {
    constructor(S) {
        this.S = S;
        this.C = palette(S);
        this.parts = new S.Particles(320);
        this.pops = new S.Popups();
        this.shake = new S.Shake();
        this.trail = [];            // recent ball positions (first ball)
        this.paddleLit = 0;
        this.miss = 0;
        this.toast = { text: '', ms: 0, color: null };
    }
    event(e, g) {
        const S = this.S, C = this.C, b = g.balls[0];
        if (e.type === 'break') {
            const c = e.max >= 3 ? C.hp[3] : e.max === 2 ? C.hp[2] : C.hp[1];
            this.parts.burst(e.x, HUD + e.y, c, 16, { speed: 460, life: 520, gravity: 300, size: 4 });
            this.shake.kick(2 + e.max);
            if (g.streak >= 4 && g.streak % 4 === 0) this.pops.add(g.streak + ' in a row', e.x - 60, HUD + e.y, S.P.gold, { size: 28 });
        } else if (e.type === 'hit' || e.type === 'steel') {
            if (b) this.parts.burst(b.x, HUD + b.y, e.type === 'steel' ? '#ffffff' : C.hp[2], 6, { speed: 300, life: 260 });
        } else if (e.type === 'paddle') {
            this.paddleLit = 1;
            if (b) this.parts.burst(b.x, HUD + b.y, C.paddle, 8, { dir: 0, spread: 100, speed: 340, life: 300 });
        } else if (e.type === 'power') {
            const p = g.paddle;
            this.parts.burst(E.PADDLE_X + 10, HUD + p.y, C.power[e.kind], 24, { dir: 0, spread: 160, speed: 420, life: 600 });
            this.toast = { text: POWER_NAME[e.kind], ms: 1400, color: C.power[e.kind] };
        } else if (e.type === 'miss') {
            this.shake.kick(14); this.miss = 1; this.trail = [];
        } else if (e.type === 'clear') {
            this.toast = { text: 'Level ' + e.level + ' cleared', ms: 1600, color: S.P.gold };
            for (let i = 0; i < 6; i++) this.parts.burst(E.BRICK_X0 + 200, HUD + 35 + i * 70, S.P.gold, 10, { speed: 520, life: 800 });
        } else if (e.type === 'over') {
            this.shake.kick(18);
        }
    }
    update(dt, g) {
        const b = g.balls[0];
        if (b && g.state === 'play') { this.trail.push([b.x, HUD + b.y]); if (this.trail.length > 12) this.trail.shift(); } else this.trail = [];
        this.paddleLit = Math.max(0, this.paddleLit - dt / 250);
        this.miss = Math.max(0, this.miss - dt / 700);
        this.toast.ms = Math.max(0, this.toast.ms - dt);
        this.parts.update(dt); this.pops.update(dt); this.shake.update(dt);
    }
}

function draw(cv, g, S, fx, view) {
    const P = S.P, C = fx.C, ox = fx.shake.x, oy = fx.shake.y, FY = (y) => HUD + y + oy, FX = (x) => x + ox;
    S.backdrop(cv, 0, 44, W, H - 44, { tint: HUE, grid: 50, horizon: 0.4 });
    // the field: a glass floor, walls lit in the hue, the goal line by the paddle red after a miss
    cv.gradientRect(0, HUD, W, E.FH, [[0, [255, 255, 255, 6]], [1, [255, 255, 255, 0]]]);
    S.glowLine(cv, 0, HUD - 2 + oy, W, HUD - 2 + oy, 2, HUE, 0.6);
    S.glowLine(cv, W - 6 + ox, HUD, W - 6 + ox, H, 2, HUE, 0.5);
    cv.rampRect(0, HUD, 40, E.FH, 0, [S.a(P.bad, 0.15 + 0.5 * fx.miss), S.a(P.bad, 0)]);
    // a soft light behind the wall
    S.halo(cv, E.BRICK_X0 + 400, HUD + E.FH / 2, 420, HUE, 0.5);
    // bricks
    for (const k of g.bricks) {
        const x = FX(k.x), y = FY(k.y), c = brickColor(C, k);
        if (k.flash > 0) { S.glowRect(cv, x, y, k.w, k.h, 6, '#ffffff', 0.8); cv.roundRect(x, y, k.w, k.h, 6, '#ffffff'); continue; }
        if (k.steel) {
            cv.card(x, y, k.w, k.h, 6, [[0, '#9aa6bd'], [0.5, '#5a6578'], [1, '#353d4c']]);
            cv.line(x + 12, y + k.h - 10, x + k.w - 10, y + 12, 2, [255, 255, 255, 60]);
            cv.strokeRoundRect(x, y, k.w, k.h, 6, 1.5, [255, 255, 255, 50]);
            continue;
        }
        const worn = k.max > 1 ? k.hp / k.max : 1;
        S.block(cv, x, y, k.w, k.h, 6, c, 0);
        if (k.bonus) star(cv, x + k.w / 2, y + k.h / 2, 11, '#ffffff');
        else if (k.max > 1) for (let i = 0; i < k.hp; i++) cv.circle(x + k.w / 2, y + k.h / 2 + (i - (k.hp - 1) / 2) * 12, 3.5, [255, 255, 255, 150]);
        if (worn < 1) cv.line(x + 10, y + 8, x + k.w * 0.6, y + k.h - 8, 2, [0, 0, 0, 90]);   // a crack once hit
    }
    // power-ups falling
    for (const d of g.drops) {
        const x = FX(d.x), y = FY(d.y), c = C.power[d.kind];
        S.glowRect(cv, x - 16, y - 16, 32, 32, 9, c, 0.8);
        S.block(cv, x - 16, y - 16, 32, 32, 9, c, 0);
        cv.text(POWER_LABEL[d.kind], x, y + 9, 26, P.bg0, { font: 'bold', align: 'center', literal: true });
    }
    // paddle
    const p = g.paddle, px = FX(E.PADDLE_X), py = FY(p.y - p.h / 2);
    S.block(cv, px, py, E.PADDLE_T, p.h, 8, g.wideMs > 0 ? S.lighten(C.paddle, 0.2) : C.paddle, 0.7 + 0.9 * fx.paddleLit);
    // ball trail and balls
    for (let i = 1; i < fx.trail.length; i++) {
        const a = fx.trail[i - 1], c = fx.trail[i], k = i / fx.trail.length;
        cv.line(a[0] + ox, a[1] + oy, c[0] + ox, c[1] + oy, E.BALL_R * 2 * k, S.a(HUE, 0.35 * k));
    }
    for (const b of g.balls) S.glowCircle(cv, FX(b.x), FY(b.y), E.BALL_R, '#ffffff', g.slowMs > 0 ? 0.6 : 1);
    fx.parts.draw(cv, ox, oy);
    fx.pops.draw(cv, ox, oy);
    S.vignette(cv, 0, 44, W, H - 44);
    hud(cv, g, S, fx, view);
    overlays(cv, g, S, fx, view);
}

function hud(cv, g, S, fx, view) {
    const P = S.P, C = fx.C, y = 92;
    S.stat(cv, 'Score', g.score, 40, y, { size: 44, color: P.ink, glow: true });
    S.stat(cv, 'Best', Math.max(view.best || 0, g.score), 300, y, { size: 32, color: P.dim });
    S.stat(cv, 'Level', g.level + 1, 520, y, { size: 32, color: HUE });
    S.label(cv, g.levelName, 580, y - 4, P.dim, { size: 14 });
    let tx = 1010;
    if (g.wideMs > 0) { S.label(cv, 'Wide', tx, y - 26, C.power.wide, { size: 11 }); S.meter(cv, tx, y - 14, 110, 8, g.wideMs / 15000, C.power.wide); tx += 140; }
    if (g.slowMs > 0) { S.label(cv, 'Slow', tx, y - 26, C.power.slow, { size: 11 }); S.meter(cv, tx, y - 14, 110, 8, g.slowMs / 10000, C.power.slow); }
    S.label(cv, 'Lives', W - 40, y - 34, P.dim, { size: 13, align: 'right' });
    for (let i = 0; i < Math.max(g.lives, 3); i++) {
        const lx = W - 50 - i * 26;
        if (i < g.lives) S.block(cv, lx, y - 22, 10, 26, 4, C.paddle, 0.5);
        else cv.roundRect(lx, y - 22, 10, 26, 4, [255, 255, 255, 18]);
    }
}

function star(cv, cx, cy, r, col) {
    const pts = [];
    for (let i = 0; i < 10; i++) {
        const an = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r;
        pts.push([cx + Math.cos(an) * rr, cy + Math.sin(an) * rr]);
    }
    for (let i = 0; i < 10; i += 2) cv.quad([[cx, cy], pts[(i + 9) % 10], pts[i], pts[i + 1]], col);
}

function overlays(cv, g, S, fx, view) {
    const P = S.P;
    if (g.over || view.ended) return;
    if (g.banner > 0) {
        const w = 620, h = g.state === 'serve' ? 196 : 160, x = CX - w / 2, y = HUD + (E.FH - h) / 2;
        S.panel(cv, x, y, w, h, { r: 22, accent: HUE, glow: true });
        S.label(cv, 'Level ' + (g.level + 1), CX, y + 44, HUE, { align: 'center', size: 15 });
        cv.text(g.levelName, CX, y + 98, 44, P.ink, { font: 'bold', align: 'center', literal: true });
        if (g.level >= E.LEVELS.length) S.chip(cv, 'Faster', CX, y + 118, P.warn, { size: 12, align: 'center' });
        if (g.state === 'serve') S.label(cv, 'Turn to move, press to launch', CX, y + h - 22, P.dim, { align: 'center', size: 13 });
    } else if (g.state === 'serve') {
        S.label(cv, 'Press the controller or tap to launch', CX, HUD + E.FH - 26, P.dim, { align: 'center', size: 15 });
    }
    const t = fx.toast;
    if (t.ms > 0) {
        cv.alpha(Math.min(1, t.ms / 300));
        S.chip(cv, t.text, CX, HUD + 40, t.color || P.ink, { size: 18, align: 'center', solid: true });
        cv.alpha(1);
    }
}

/** The menu tile: a ball knocking bricks out of a small wall */
function art(cv, x, y, w, h, S, ms) {
    const t = ms / 1000, C = palette(S), cols = 4, rows = 5, bw = 22, bh = (h - 30) / rows;
    const wx = x + w - 20 - cols * (bw + 4), gone = Math.floor(t * 1.5) % (rows * cols + 6);
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const idx = (rows - 1 - r) * cols + (cols - 1 - c);
            if ((c * 7 + r * 3) % (rows * cols) < gone && c === 0) continue;
            const col = c === cols - 1 ? C.hp[3] : c === 2 ? C.hp[2] : idx % 5 === 0 ? C.bonus : C.hp[1];
            S.block(cv, wx + c * (bw + 4), y + 15 + r * bh, bw, bh - 4, 4, col, 0);
        }
    }
    const ph = (t * 0.8) % 2, k = ph < 1 ? ph : 2 - ph;
    const bx = x + 34 + (wx - x - 50) * k, by = y + h / 2 + Math.sin(t * 2.1) * h * 0.3;
    S.block(cv, x + 16, by - 26, 10, 52, 4, C.paddle, 0.6);
    S.glowCircle(cv, bx, by, 7, '#ffffff', 1);
}

module.exports = { Fx, draw, art, HUE, POWER_NAME };
