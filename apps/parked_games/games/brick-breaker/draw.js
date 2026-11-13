'use strict';
/**
 * draw.js - Brick Breaker's picture, drawn with the kit's recorder (kit/runtime/record.js API:
 * fillRect, roundRect, strokeRoundRect, gradientRect, circle, arc, line, alpha, text).
 *
 * The game is laid out on the 1600 x 520 page: a score strip from y 44 (above it the kit's
 * full-screen layout shows the HMI's status strip: page y 0..38 is not on screen) and the
 * 1600 x 420 field below it, from y 100. Drawn scaled into a rect (the shell gives the whole page).
 */
const E = require('./engine');

const W = 1600, H = 520, TOP = 44, HUD = 100;     // HUD: where the field starts
// messages go in the middle of the open space between the paddle and the bricks
const CX = Math.round((E.PADDLE_X + E.PADDLE_T + E.BRICK_X0) / 2);

const C = {
    bg0: '#05070d', bg1: '#0c1424',
    grid: '#ffffff08',
    edge: '#2a3a5a',
    text: '#e8eefc', dim: '#7d8aa8',
    paddle: '#36d1ff', paddleHi: '#b9f0ff',
    ball: '#ffffff', glow: '#7fe3ff',
    // by hits left
    hp: { 1: '#22c7a9', 2: '#ffb020', 3: '#ff4f6d' },
    hpHi: { 1: '#8ff5e0', 2: '#ffe08a', 3: '#ffa3b3' },
    steel: '#6b7891', steelHi: '#aab6cc',
    bonus: '#a77bff', bonusHi: '#e0d0ff',
    flash: '#ffffff',
    power: { wide: '#36d1ff', multi: '#ffd23f', slow: '#7cff7a', life: '#ff5c8a' },
};
const POWER_LABEL = { wide: 'W', multi: 'M', slow: 'S', life: '+' };
const POWER_NAME = { wide: 'Wide paddle', multi: 'Multi-ball', slow: 'Slow ball', life: 'Extra life' };

/** where the 1600 x 520 page lands in rect (uniform scale, centred) */
function fit(rect) {
    const s = Math.min(rect.w / W, rect.h / H);
    return { s, ox: rect.x + (rect.w - W * s) / 2, oy: rect.y + (rect.h - H * s) / 2 };
}

/**
 * Draw one frame. g: Engine; view: { best, ended, toast: { text, ms, color } }.
 */
function draw(cv, rect, g, view) {
    const f = fit(rect), s = f.s;
    const X = (x) => f.ox + x * s, Y = (y) => f.oy + y * s;              // page -> canvas
    const FX = (x) => X(x), FY = (y) => Y(HUD + y);                      // field -> canvas
    const L = (v) => v * s;

    // background
    cv.gradientRect(X(0), Y(0), L(W), L(H), [[0, C.bg1], [1, C.bg0]]);
    for (let x = 100; x < W; x += 100) cv.fillRect(FX(x), FY(0), Math.max(1, L(1)), L(E.FH), C.grid);
    cv.fillRect(X(0), Y(HUD - 3), L(W), Math.max(1, L(2)), C.edge);

    hud(cv, g, view, X, Y, s);

    // bricks
    for (const k of g.bricks) {
        const x = FX(k.x), y = FY(k.y), w = L(k.w), h = L(k.h), r = L(6);
        const base = k.steel ? C.steel : k.bonus ? C.bonus : C.hp[Math.max(1, Math.min(3, k.hp))];
        const hi = k.steel ? C.steelHi : k.bonus ? C.bonusHi : C.hpHi[Math.max(1, Math.min(3, k.hp))];
        cv.roundRect(x, y, w, h, r, k.flash > 0 ? C.flash : base);
        if (k.flash > 0) continue;
        cv.roundRect(x + L(4), y + L(4), L(5), h - L(8), L(2.5), hi);           // light edge (facing the paddle)
        if (k.steel) {
            cv.line(x + L(12), y + h - L(10), x + w - L(10), y + L(12), Math.max(1, L(3)), C.steelHi + '80');
        } else if (k.bonus) {
            star(cv, x + w / 2 + L(2), y + h / 2, L(11), C.bonusHi);
        } else if (k.max > 1) {
            // dots: hits it still takes
            for (let i = 0; i < k.hp; i++) cv.circle(x + w / 2 + L(3), y + h / 2 + L((i - (k.hp - 1) / 2) * 12), L(3.5), '#00000055');
        }
    }

    // power-ups falling towards the paddle
    for (const d of g.drops) {
        const x = FX(d.x), y = FY(d.y), col = C.power[d.kind];
        cv.roundRect(x - L(16), y - L(16), L(32), L(32), L(9), col);
        cv.text(POWER_LABEL[d.kind], x, y + L(9), L(26), '#05070d', { font: 'bold', align: 'center', literal: true });
    }

    // paddle
    const p = g.paddle;
    const px = FX(E.PADDLE_X), py = FY(p.y - p.h / 2), ph = L(p.h), pw = L(E.PADDLE_T);
    cv.alpha(0.18); cv.roundRect(px - L(6), py - L(6), pw + L(12), ph + L(12), L(14), C.paddle); cv.alpha(1);
    cv.roundRect(px, py, pw, ph, L(9), C.paddle);
    cv.roundRect(px + pw - L(6), py + L(8), L(3), ph - L(16), L(1.5), C.paddleHi);

    // balls
    for (const b of g.balls) {
        const x = FX(b.x), y = FY(b.y);
        cv.alpha(0.22); cv.circle(x, y, L(E.BALL_R * 2), C.glow); cv.alpha(1);
        cv.circle(x, y, L(E.BALL_R), C.ball);
    }

    overlays(cv, g, view, X, Y, s);
}

function hud(cv, g, view, X, Y, s) {
    const L = (v) => v * s, base = Y(TOP + 38);
    let x = X(110);
    cv.text('SCORE', x, base, L(24), C.dim, { font: 'bold' });
    cv.text(String(g.score), x + L(100), base + L(2), L(40), C.text, { font: 'num', literal: true });
    x = X(460);
    cv.text('BEST', x, base, L(24), C.dim, { font: 'bold' });
    cv.text(String(Math.max(view.best || 0, g.score)), x + L(78), base + L(2), L(40), C.text, { font: 'num', literal: true });
    x = X(760);
    cv.text('LEVEL', x, base, L(24), C.dim, { font: 'bold' });
    cv.text(String(g.level + 1), x + L(96), base + L(2), L(40), C.text, { font: 'num', literal: true });
    cv.text(g.levelName, x + L(150), base, L(24), C.dim, { font: 'label', literal: true });
    // lives: small paddles
    const lx = X(1560);
    for (let i = 0; i < g.lives; i++) cv.roundRect(lx - L(i * 30) - L(10), Y(TOP + 12), L(10), L(30), L(5), C.paddle);
    cv.text('LIVES', lx - L(g.lives * 30) - L(14), base, L(24), C.dim, { font: 'bold', align: 'right' });
    // power-up timers
    let tx = X(1100);
    if (g.wideMs > 0) { pill(cv, tx, Y(TOP + 11), s, C.power.wide, 'W ' + Math.ceil(g.wideMs / 1000)); tx += L(84); }
    if (g.slowMs > 0) pill(cv, tx, Y(TOP + 11), s, C.power.slow, 'S ' + Math.ceil(g.slowMs / 1000));
}

function pill(cv, x, y, s, col, str) {
    cv.roundRect(x, y, 74 * s, 32 * s, 16 * s, col);
    cv.text(str, x + 37 * s, y + 24 * s, 22 * s, '#05070d', { font: 'bold', align: 'center', literal: true });
}

function star(cv, cx, cy, r, col) {
    const pts = [];
    for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r;
        pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
    }
    // five kite-shaped quads from the centre make the star
    for (let i = 0; i < 10; i += 2) cv.quad([[cx, cy], pts[(i + 9) % 10], pts[i], pts[i + 1]], col);
}

function banner(cv, X, Y, s, title, sub, sub2) {
    const L = (v) => v * s;
    const w = 660, h = sub2 ? 200 : 160, x = CX - w / 2, y = HUD + (E.FH - h) / 2;
    cv.alpha(0.88); cv.roundRect(X(x), Y(y), L(w), L(h), L(22), '#05070d'); cv.alpha(1);
    cv.strokeRoundRect(X(x), Y(y), L(w), L(h), L(22), L(2), C.edge);
    cv.text(title, X(CX), Y(y + 66), L(52), C.text, { font: 'bold', align: 'center', literal: true });
    if (sub) cv.text(sub, X(CX), Y(y + 114), L(28), C.dim, { font: 'label', align: 'center', literal: true });
    if (sub2) cv.text(sub2, X(CX), Y(y + 158), L(28), C.dim, { font: 'label', align: 'center', literal: true });
}

function overlays(cv, g, view, X, Y, s) {
    const L = (v) => v * s;
    // (game over and pause: the shell draws its own card over the frame)
    if (g.over || view.ended) return;
    if (g.banner > 0) {
        banner(cv, X, Y, s, 'LEVEL ' + (g.level + 1), g.levelName + (g.level >= E.LEVELS.length ? '  -  faster' : ''),
            g.state === 'serve' ? 'Turn the controller to move, press to launch' : null);
    } else if (g.state === 'serve') {
        cv.text('Press the controller or tap to launch', X(CX), Y(HUD + E.FH - 26), L(28), C.dim, { font: 'label', align: 'center', literal: true });
    }
    if (view.toast && view.toast.ms > 0) {
        cv.alpha(Math.min(1, view.toast.ms / 300));
        cv.text(view.toast.text, X(CX), Y(HUD + 60), L(32), view.toast.color || C.text, { font: 'bold', align: 'center', literal: true });
        cv.alpha(1);
    }
}

module.exports = { draw, fit, W, H, TOP, HUD, POWER_NAME, C };
