'use strict';
/**
 * hudart.js - the HUD bracket's drawing (docs/mockups/hud-m-style.html: bracket, gearBlock, sq) with the kit
 * Canvas's quad, line, fillRect and text only (the GPU Recorder has the same): the static image layer sent to the HUD
 * (output.js). Node 8.
 *
 * b = geom.bracket(...) (scene px, already placed and sized). Every function maps a scene point (x, y) to
 * (dx + x * k, dy + y * k). No speed, unit or line: the stock HUD shows the speed under our art.
 */
const GLYPHS = {
    0: '0 0,1 0,1 1.6,0 1.6,z', 1: '.05 .34,.5 0,.5 1.6', 2: '0 0,1 0,1 .8,0 .8,0 1.6,1 1.6', 3: '0 0,1 0,1 1.6,0 1.6|.3 .8,1 .8',
    4: '.72 1.6,.72 0,0 1.04,1 1.04', 5: '1 0,0 0,0 .78,1 .78,1 1.6,0 1.6', 6: '1 0,0 0,0 1.6,1 1.6,1 .78,0 .78',
    7: '0 0,1 0,1 .2,.36 1.6', 8: '0 0,1 0,1 1.6,0 1.6,z|0 .8,1 .8', 9: '1 .82,0 .82,0 0,1 0,1 1.6,0 1.6',
    // the selector letters (0.4.1), squared like the digits: P, R (P plus a leg), N
    P: '0 1.6,0 0,1 0,1 .8,0 .8', R: '0 1.6,0 0,1 0,1 .8,0 .8|.45 .8,1 1.6', N: '0 1.6,0 0,1 1.6,1 0',
};
const GLYPH = {};
Object.keys(GLYPHS).forEach((c) => {
    GLYPH[c] = GLYPHS[c].split('|').map((s) => s.split(',').map((p) => (p === 'z' ? p : p.split(' ').map(Number))));
});

/** Squared stroke digits centred on (x, y) (scene px): the mockups' sq(). */
function digits(cv, str, x, y, h, color, wide, sw, dx, dy, k) {
    const u = h / 1.6, wd = u * wide, gap = 0.42 * u;
    const adv = (c) => (c === '1' ? 0.55 : 1) * wd;
    let total = -gap;
    for (let i = 0; i < str.length; i++) total += adv(str[i]) + gap;
    let cx = x - total / 2;
    for (let i = 0; i < str.length; i++) {
        (GLYPH[str[i]] || []).forEach((stroke) => {
            let first = null, prev = null;
            stroke.forEach((p) => {
                const q = p === 'z' ? first : [cx + p[0] * wd, y - h / 2 + p[1] * u];
                if (prev) cv.line(dx + prev[0] * k, dy + prev[1] * k, dx + q[0] * k, dy + q[1] * k, sw * k, color);
                if (!first) first = q;
                prev = q;
            });
        });
        cx += adv(str[i]) + gap;
    }
}

/** The band between offsets o0 and o1 along the path from s0 to s1 (px), as quads overlapping half a px. */
function band(cv, b, s0, s1, o0, o1, color, dx, dy, k) {
    if (!(s1 > s0)) return;
    const steps = Math.max(1, Math.ceil((s1 - s0) / 4));
    for (let i = 0; i < steps; i++) {
        const a = b.at(s0 + (s1 - s0) * i / steps), c = b.at(s0 + (s1 - s0) * (i + 1) / steps);
        const tx = c.x - a.x, ty = c.y - a.y, l = Math.hypot(tx, ty) || 1, ex = tx / l * 0.5, ey = ty / l * 0.5;
        const P = (p, o, e) => [dx + (p.x + p.nx * o + e * ex) * k, dy + (p.y + p.ny * o + e * ey) * k];
        cv.quad([P(a, o0, i ? -1 : 0), P(c, o0, i < steps - 1 ? 1 : 0), P(c, o1, i < steps - 1 ? 1 : 0), P(a, o1, i ? -1 : 0)], color);
    }
}

/** Rail, ticks, numerals 0 to scaleMax and the red-zone marks. */
function drawBracketStatic(cv, b, colors, dx, dy, k) {
    const B = b.B, S = b.S, mid = (b.o0 + b.o1) / 2, kEnd = B.scaleMax / 1000;
    // the rail, one quad per path segment, each reaching half a px past its ends (no seams at the knee)
    for (let i = 1; i < b.pts.length; i++) {
        const a = b.pts[i - 1], c = b.pts[i], vx = c[0] - a[0], vy = c[1] - a[1], l = Math.hypot(vx, vy);
        if (l < 0.001) continue;
        const tx = vx / l, ty = vy / l, nx = -ty, ny = tx, e = 0.5;
        const P = (p, o, s) => [dx + (p[0] + nx * o + tx * e * s) * k, dy + (p[1] + ny * o + ty * e * s) * k];
        cv.quad([P(a, 0, -1), P(c, 0, 1), P(c, b.rail, 1), P(a, b.rail, -1)], colors.rail);
    }
    for (let n = 0; n <= kEnd; n++) {
        const p = b.at(b.sOf(n * 1000)), w = (n === 0 || n === kEnd ? 2.6 : 1.9) * S / 2, len = B.tickMajor * S, tx = p.ny, ty = -p.nx;
        const P = (o, s) => [dx + (p.x + p.nx * o + tx * w * s) * k, dy + (p.y + p.ny * o + ty * w * s) * k];
        cv.quad([P(b.rail, -1), P(b.rail, 1), P(b.rail + len, 1), P(b.rail + len, -1)], colors.rail);
    }
    b.nums.forEach((m) => digits(cv, String(m.k), m.x, m.y, b.numH, colors.rail, 1.15, b.numSw, dx, dy, k));
    const z = B.redzone, h = 1.6 * S;
    band(cv, b, b.sOf(z.yellow + 30), b.sOf(z.red - 30), mid - h, mid + h, colors.zy, dx, dy, k);
    band(cv, b, b.sOf(z.red + 30), b.sOf(B.scaleMax - 40), mid - h, mid + h, colors.zr, dx, dy, k);
}

/** What drawGear draws for g: '1' to '9' (a whole number 1 to 9 or that string) or 'P' / 'R' / 'N'; anything else ''. */
function glyphOf(g) {
    if (typeof g === 'number') return Math.floor(g) === g && g >= 1 && g <= 9 ? String(g) : '';
    return typeof g === 'string' && /^[1-9PRN]$/.test(g) ? g : '';
}

/** The gear digit or selector letter (glyphOf; anything else draws nothing), at the bracket's placed gear (b.gear). */
function drawGear(cv, b, gear, color, dx, dy, k) {
    const c = glyphOf(gear);
    if (!c) return;
    const G = b.gear;
    digits(cv, c, G.x, G.y, G.h, color, 1.3, G.h * 0.23, dx, dy, k);
}

module.exports = { drawBracketStatic, drawGear, glyphOf, digits };
