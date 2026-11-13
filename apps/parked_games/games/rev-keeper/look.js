'use strict';
/**
 * Rev Keeper in the shell's Night Circuit look (api.style): an LED rev strip (segments light up to
 * the needle, cyan to amber to red), the green zone as a lit band, sparks, popups and shake on
 * multipliers, level-ups and a blown engine. Fx watches the round (logic.js is unchanged).
 */
const W = 1600, H = 520;
const HUE = '#ff5a3c';
const X0 = 80, X1 = W - 80, GW = X1 - X0, GY = 196, GH = 104, SEGS = 64;
const X = (v) => X0 + v * GW;

class Fx {
    constructor(S) {
        this.S = S;
        this.parts = new S.Particles(300);
        this.pops = new S.Popups();
        this.shake = new S.Shake();
        this.mult = 1; this.level = 1; this.state = 'count'; this.lostK = 0; this.needleShown = 0;
    }
    update(dt, g) {
        const S = this.S, P = S.P;
        if (g.mult > this.mult) {
            this.pops.add('x' + g.mult, X(g.needle), GY - 30, g.mult >= 6 ? P.gold : P.good, { size: 44 });
            this.parts.burst(X(g.needle), GY + GH / 2, P.good, 18, { speed: 420, life: 500 });
        } else if (g.mult < this.mult) { this.shake.kick(6); this.lostK = 1; }
        this.mult = g.mult;
        if (g.level > this.level) {
            this.level = g.level;
            this.pops.add('Level ' + g.level, W / 2, GY + GH + 70, P.gold, { size: 36, life: 1400 });
            for (let i = 0; i < 6; i++) this.parts.burst(X0 + GW * (i + 0.5) / 6, GY + GH / 2, P.gold, 8, { speed: 380, life: 600 });
        }
        if (g.state !== this.state) {
            if (g.state === 'over') {
                this.shake.kick(22);
                this.parts.burst(X(g.needle), GY + GH / 2, P.bad, 70, { speed: 900, life: 1100, gravity: 600 });
                this.parts.burst(X(g.needle), GY + GH / 2, '#8a8f99', 30, { speed: 220, life: 1600, gravity: -80, size: 6, drag: 1.2 });
            }
            this.state = g.state;
        }
        // a hot engine sheds sparks off the needle
        if (g.state === 'play' && g.strain > 0.75 && Math.random() < g.strain) this.parts.burst(X(g.needle), GY + GH / 2, HUE, 1, { dir: -90, spread: 70, speed: 300, life: 380, gravity: 700, size: 2 });
        this.needleShown = S.approach(this.needleShown, g.needle, dt, 0.9);
        this.lostK = Math.max(0, this.lostK - dt / 1200);
        this.parts.update(dt); this.pops.update(dt); this.shake.update(dt);
    }
}

function segColor(S, v) {
    if (v > 0.94) return S.P.bad;
    if (v > 0.75) return S.mix(HUE, S.P.bad, (v - 0.75) / 0.19);
    if (v > 0.45) return S.mix('#ffc547', HUE, (v - 0.45) / 0.3);
    return S.mix(S.P.cold, '#ffc547', v / 0.45);
}

function draw(cv, g, S, fx, view) {
    const P = S.P, ox = fx.shake.x, oy = fx.shake.y, z = g.zone, n = g.needle;
    S.backdrop(cv, 0, 44, W, H - 44, { tint: HUE, grid: 48, horizon: 0.6 + 0.8 * g.strain });
    S.panel(cv, X0 - 30 + ox, GY - 48 + oy, GW + 60, GH + 110, { r: 22 });
    // the zone: a lit band behind the segments, its centre third brighter
    const play = g.state === 'play', glow = g.inside && play, zx = X(z.c - z.w) + ox, zw = GW * z.w * 2;
    const jump = g.pendingJump();
    if (jump) {
        const blink = 0.5 + 0.5 * Math.sin(jump.t * 22);
        cv.strokeRoundRect(X(jump.to - z.w) + ox, GY - 10 + oy, zw, GH + 20, 12, 2.5, S.a(P.good, 0.3 + 0.5 * blink));
    }
    S.glowRect(cv, zx, GY - 10 + oy, zw, GH + 20, 12, P.good, glow ? 1.2 : 0.4);
    cv.roundRect(zx, GY - 10 + oy, zw, GH + 20, 12, S.a(P.good, glow ? 0.28 : 0.14));
    cv.roundRect(X(z.c - z.w / 3) + ox, GY - 10 + oy, zw / 3, GH + 20, 8, S.a(P.good, glow && g.centred ? 0.3 : 0.1));
    // LED segments
    const sw = GW / SEGS;
    for (let i = 0; i < SEGS; i++) {
        const v = (i + 0.5) / SEGS, x = X0 + i * sw + 2 + ox, lit = v <= fx.needleShown;
        const c = segColor(S, v);
        if (lit) {
            cv.roundRect(x - 2, GY + 6 + oy, sw, GH - 12, 4, S.a(c, 0.25));
            cv.card(x, GY + 10 + oy, sw - 4, GH - 20, 3, [[0, S.lighten(c, 0.35)], [0.5, c], [1, S.darken(c, 0.25)]]);
        } else cv.roundRect(x, GY + 10 + oy, sw - 4, GH - 20, 3, v > 0.94 ? S.a(P.bad, 0.16) : [255, 255, 255, 12]);
    }
    // the needle: a bright line with a marker
    const nx = X(n) + ox;
    S.glowLine(cv, nx, GY - 14 + oy, nx, GY + GH + 14 + oy, 4, '#ffffff', 0.8);
    cv.quad([[nx - 12, GY - 30 + oy], [nx + 12, GY - 30 + oy], [nx, GY - 14 + oy], [nx, GY - 14 + oy]], '#ffffff');
    // the scale: 0 .. 8 (x 1000 rpm)
    for (let i = 0; i <= 16; i++) {
        const tx = X(i / 16) + ox, major = i % 2 === 0;
        cv.fillRect(tx - 1, GY + GH + 8 + oy, major ? 2 : 1, major ? 12 : 6, S.a(P.dim, major ? 0.8 : 0.4));
        if (major) cv.text(String(i / 2), tx, GY + GH + 40 + oy, 20, i >= 15 ? P.bad : P.dim, { font: 'bold', align: 'center' });
    }
    // engine strain
    const sy = 416, s = g.strain, sc = s > 0.75 ? P.bad : s > 0.45 ? '#ffc547' : P.cold;
    S.label(cv, 'Engine strain', X0, sy - 12, P.dim, { size: 13 });
    cv.text(Math.round(s * 100) + ' %', X1, sy - 10, 18, s > 0.75 ? P.bad : P.dim, { font: 'bold', align: 'right' });
    const pulse = s > 0.75 && play ? 0.7 + 0.3 * Math.sin(g.clock * 14) : 1;
    cv.alpha(pulse); S.meter(cv, X0, sy, GW, 14, s, sc, { glow: s > 0.75 }); cv.alpha(1);
    cv.text(g.rpm() + ' rpm', W / 2, 482, 22, P.dim, { font: 'num', align: 'center' });
    fx.parts.draw(cv, ox, oy);
    fx.pops.draw(cv, ox, oy);
    S.flash(cv, 0, 44, W, H - 44, P.bad, g.state === 'over' ? Math.max(0, 1 - g.t / 0.8) : s > 0.9 && play ? 0.15 * (0.5 + 0.5 * Math.sin(g.clock * 14)) : 0);
    hud(cv, g, S, fx, view);
}

function hud(cv, g, S, fx, view) {
    const P = S.P, y = 112;
    S.chip(cv, 'Turn the knob or slide along the strip: throttle  ·  push up / down: big step', 24, 54, P.dim, { size: 13 });
    S.stat(cv, 'Score', Math.floor(g.score), W / 2, y, { size: 64, align: 'center', glow: true, color: P.ink });
    if (view.best != null) S.label(cv, 'Best ' + view.best, W / 2 + 120, y - 8, P.dim, { size: 13 });
    const m = g.mult, mc = m >= 6 ? P.gold : m >= 3 ? P.good : P.ink;
    S.stat(cv, 'Multiplier', 'x' + m, W - 260, y, { size: 44, align: 'right', color: g.state === 'play' ? mc : P.dim, glow: m >= 3 });
    if (fx.lostK > 0 && g.state === 'play') { cv.alpha(fx.lostK); S.chip(cv, 'Multiplier lost', W - 260, y + 6, P.bad, { size: 12, align: 'right' }); cv.alpha(1); }
    S.stat(cv, 'Level', g.level, W - 48, y, { size: 44, align: 'right', color: HUE });
    if (g.state === 'count') S.countdown(cv, W / 2, GY + GH / 2 + 10, Math.max(1, (2.4 - g.t) * 1000), 800, P.good, 'Keep the needle in the green');
    else if (g.state === 'over') S.chip(cv, 'Engine blown', W / 2, GY + GH + 54, P.bad, { solid: true, size: 18, align: 'center' });
}

/** The menu tile: the LED strip breathing in and out of a green band */
function art(cv, x, y, w, h, S, ms) {
    const P = S.P, t = ms / 1000, n = 0.5 + 0.38 * Math.sin(t * 1.3) + 0.06 * Math.sin(t * 5.1), segs = 14;
    const gy = y + h / 2 - 22, gh = 44, sw = (w - 28) / segs;
    const zc = 0.55 + 0.15 * Math.sin(t * 0.5);
    cv.roundRect(x + 14 + (w - 28) * (zc - 0.15), gy - 8, (w - 28) * 0.3, gh + 16, 8, S.a(P.good, 0.22));
    for (let i = 0; i < segs; i++) {
        const v = (i + 0.5) / segs, c = segColor(S, v), sx = x + 14 + i * sw;
        if (v <= n) cv.card(sx + 1, gy, sw - 3, gh, 3, [[0, S.lighten(c, 0.3)], [1, S.darken(c, 0.2)]]);
        else cv.roundRect(sx + 1, gy, sw - 3, gh, 3, [255, 255, 255, 14]);
    }
    const nx = x + 14 + (w - 28) * n;
    S.glowLine(cv, nx, gy - 12, nx, gy + gh + 12, 3, '#ffffff', 0.8);
}

module.exports = { Fx, draw, art, HUE };
