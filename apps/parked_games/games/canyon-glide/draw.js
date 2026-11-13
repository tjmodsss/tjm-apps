'use strict';
/**
 * draw.js - Canyon Glide: draws a round on the shell's canvas (the kit's recorder, 1600 x 520).
 *
 * Only the calls GAMES.md lists (gradientRect, fillRect, quad, line, polyline, circle, alpha, text), so it
 * draws the same on the GPU renderer, the software canvas and a test double.
 */
const { W, H, GX, READY_S } = require('./game');
const { clamp } = require('./cave');

const C = {
    skyTop: '#07080f', skyBottom: '#140d1c',
    farRock: '#17121f', farEdge: '#262033',
    rock: '#55344a', rockDeep: '#2f1d2b', edge: '#c77d4a', edgeDim: '#7a4a33',
    spire: '#4a3346', spireEdge: '#e09a5c',
    glider: '#f2f4f8', gliderDark: '#9aa3b4', stripe: '#3d9bff', trail: '#9fd4ff',
    crystal: '#67f0d0', crystalCore: '#e8fff8', crystalGlow: [103, 240, 208, 40],
    text: '#f4f7fb', dim: '#9a93a6', warn: '#ffb020', crit: '#ef2b2d', boost: '#ffb020', boostLow: '#4a3f2c',
    hud: [0, 0, 0, 110], card: [0, 0, 0, 175],
};

/**
 * Rock between a trace and an edge of the screen (baseY 0 = up to the top, H = down to the bottom),
 * as one quad per segment (the recorder's quad is convex: a trapezoid down to the edge always is).
 */
function fillTo(cv, pts, baseY, c) {
    for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        cv.quad([[a[0], a[1]], [b[0] + 0.75, b[1]], [b[0] + 0.75, baseY], [a[0], baseY]], c);     // overlap: no seams
    }
}

/** the far wall: a dim second cave scrolling at 40 %, for depth */
function far(cv, r) {
    const off = r.dist * 0.4, top = [], bot = [];
    for (let x = -80; x <= W + 80; x += 80) {
        const w = x + off;
        const a = Math.sin(w * 0.004) * 40 + Math.sin(w * 0.0113 + 1.3) * 22;
        const b = Math.sin(w * 0.0051 + 2.1) * 36 + Math.sin(w * 0.0137) * 20;
        top.push([x, 70 + a]); bot.push([x, H - 70 + b]);
    }
    fillTo(cv, top, 0, C.farRock); fillTo(cv, bot, H, C.farRock);
    cv.polyline(top, 2, C.farEdge); cv.polyline(bot, 2, C.farEdge);
}

function rock(cv, r) {
    const cave = r.cave, step = 40, top = [], bot = [], top2 = [], bot2 = [];
    const x0 = Math.floor(r.dist / step) * step;
    for (let w = x0; w <= r.dist + W + step; w += step) {
        const s = cave.at(w), x = w - r.dist;
        top.push([x, s.ceil]); bot.push([x, s.floor]);
        top2.push([x, s.ceil - 18]); bot2.push([x, s.floor + 18]);
    }
    fillTo(cv, top, 0, C.rock); fillTo(cv, bot, H, C.rock);
    fillTo(cv, top2, 0, C.rockDeep); fillTo(cv, bot2, H, C.rockDeep);
    for (const p of cave.spires) {
        if (p.x + p.w < r.dist || p.x - p.w > r.dist + W) continue;
        const t = cave.tri(p).map((q) => [q[0] - r.dist, q[1]]);
        cv.quad([t[0], t[1], t[2], t[2]], C.spire);
        cv.line(t[0][0] + 6, t[0][1], t[2][0], t[2][1], 3, C.spireEdge);
        cv.line(t[1][0] - 6, t[1][1], t[2][0], t[2][1], 2, C.edgeDim);
    }
    cv.polyline(top, 3, C.edge); cv.polyline(bot, 3, C.edge);
}

function crystals(cv, r) {
    const pulse = 1 + Math.sin(r.clock * 6) * 0.12;
    for (const c of r.cave.crystals) {
        if (c.taken) continue;
        const x = c.x - r.dist;
        if (x < -30 || x > W + 30) continue;
        const s = 14 * pulse;
        cv.circle(x, c.y, 30 * pulse, C.crystalGlow);
        cv.quad([[x, c.y - s * 1.4], [x + s, c.y], [x, c.y + s * 1.4], [x - s, c.y]], C.crystal);
        cv.quad([[x, c.y - s * 0.6], [x + s * 0.4, c.y], [x, c.y + s * 0.6], [x - s * 0.4, c.y]], C.crystalCore);
    }
}

function trail(cv, r) {
    const n = r.trail.length;
    if (n < 2 || r.state !== 'play') return;
    const col = r.boosting > 0.05 ? C.boost : C.trail;
    for (let i = 1; i < n; i++) {
        const a = r.trail[i - 1], b = r.trail[i], k = i / n;
        cv.alpha(k * 0.55);
        cv.line(a[0] - r.dist - 18, a[1], b[0] - r.dist - 18, b[1], 1 + k * 3 * (1 + r.boosting), col);
    }
    cv.alpha(1);
}

/** the glider: a swept delta wing seen from the side, nose to the right, tipped by its pitch */
function glider(cv, r, stripe) {
    const x = GX, y = r.y, a = -r.pitch * 0.55, ca = Math.cos(a), sa = Math.sin(a);
    const P = (u, v) => [x + u * ca - v * sa, y + u * sa + v * ca];
    if (r.boosting > 0.05) {
        const f = 18 + r.boosting * 26 + Math.sin(r.clock * 40) * 5;
        cv.quad([P(-18, -4), P(-18, 4), P(-18 - f, 1), P(-18 - f, -1)], C.boost);
    }
    cv.quad([P(-6, -2), P(14, -2), P(-20, -16), P(-26, -14)], C.gliderDark);    // far wing
    cv.quad([P(-24, -4), P(26, -2), P(26, 3), P(-24, 5)], C.glider);            // body
    cv.quad([P(26, -2), P(34, 0), P(34, 1), P(26, 3)], C.glider);               // nose
    cv.quad([P(-4, 2), P(16, 2), P(-18, 16), P(-25, 14)], C.glider);            // near wing
    cv.quad([P(-8, 4), P(6, 4), P(-14, 12), P(-18, 11)], stripe);
    cv.quad([P(-24, -4), P(-18, -4), P(-26, -14), P(-30, -14)], C.gliderDark);  // fin
}

function debris(cv, r) {
    if (r.state === 'crash') {
        const k = clamp(1 - r.t / 0.6, 0, 1);
        if (k > 0) { cv.alpha(k); cv.circle(GX, r.y, 20 + (1 - k) * 60, C.boost); cv.alpha(1); }
    }
    for (const d of r.debris) {
        const c = Math.cos(d.a) * d.s, s = Math.sin(d.a) * d.s;
        cv.quad([[d.x - c, d.y - s], [d.x + s * 0.3, d.y - c * 0.3], [d.x + c, d.y + s], [d.x - s * 0.3, d.y + c * 0.3]], C.gliderDark);
    }
}

/** hud: score and best top left, boost meter top right (the shell writes its input line bottom left); the countdown card */
function hud(cv, r, how) {
    cv.fillRect(24, 50, 260, 76, C.hud);
    cv.text(String(r.score()), 40, 98, 44, r.flash > 0 ? C.crystal : C.text, { font: 'num' });
    cv.text('BEST ' + r.best, 40, 118, 18, C.dim, { font: 'bold' });
    cv.text(r.metres() + ' m', 268, 98, 22, C.dim, { font: 'bold', align: 'right' });

    const bw = 260, bx = W - 24 - bw, by = 76;
    cv.fillRect(bx, by - 26, bw, 48, C.hud);
    cv.text('BOOST', bx + 16, by - 4, 16, C.dim, { font: 'bold' });
    cv.fillRect(bx + 92, by - 16, bw - 108, 12, C.boostLow);
    cv.fillRect(bx + 92, by - 16, (bw - 108) * r.energy, 12, r.energy < 0.2 ? C.crit : C.boost);
    cv.text(how.boost, bx + 92, by + 14, 14, C.dim, { font: 'label' });

    if (r.state === 'ready') {
        const n = Math.max(1, Math.ceil(READY_S - r.t));
        cv.fillRect(W / 2 - 300, H / 2 - 92, 600, 178, C.card);
        cv.text('CANYON GLIDE', W / 2, H / 2 - 46, 30, C.text, { font: 'bold', align: 'center' });
        cv.text(String(n), W / 2, H / 2 + 26, 64, C.warn, { font: 'num', align: 'center' });
        cv.text(how.steer, W / 2, H / 2 + 64, 18, C.dim, { font: 'label', align: 'center' });
    }
}

/** draw round r; theme = the kit's colours (accent2 for the glider stripe); how = { steer, boost } hint texts */
function draw(cv, r, theme, how) {
    const stripe = (theme && theme.accent2) || C.stripe;
    cv.gradientRect(0, 0, W, H, [[0, C.skyTop], [1, C.skyBottom]]);
    far(cv, r);
    rock(cv, r);
    crystals(cv, r);
    trail(cv, r);
    if (r.state === 'crash' || r.state === 'over') debris(cv, r);
    else glider(cv, r, stripe);
    hud(cv, r, how || { steer: '', boost: '' });
    return cv;
}

module.exports = { draw, COLORS: C };
