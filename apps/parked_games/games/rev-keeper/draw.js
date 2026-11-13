'use strict';
/**
 * draw.js - Rev Keeper's picture: a wide rev strip across the 1600 x 520 screen with the green zone,
 * the needle and the engine strain bar under it. Big text is digits only (the baked fonts).
 */
const W = 1600, H = 520;

// own palette, readable on the dark HMI by day and by night
const C = {
    bg: '#06080c', panel: '#10151d', track: '#161c25', tick: '#4c5666', text: '#f2f5f9', dim: '#8a95a6',
    zone: '#2fd27a', zoneHot: '#7dffb3', needle: '#ffffff', fill: '#ff8a1f', fillHot: '#ffcf4a',
    red: '#ef2b2d', warn: '#ffb020', cool: '#3d8bff',
};
const A = (hex, a) => {                   // '#rrggbb' + alpha 0..1 -> [r, g, b, a]
    const s = hex.replace('#', '');
    return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16), Math.round(a * 255)];
};
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const bold = (extra) => Object.assign({ font: 'bold' }, extra);
const num = (extra) => Object.assign({ font: 'num' }, extra);

/** view: { best: number | null, source: 'knob' | 'touch', paused: bool, throttle: 0..1 } */
function draw(cv, g, view) {
    view = view || {};
    cv.fillRect(0, 0, W, H, C.bg);
    hud(cv, g, view);
    gauge(cv, g);
    strain(cv, g);
    overlay(cv, g, view);
}

function hud(cv, g, view) {
    cv.text('REV KEEPER', 48, 72, 30, C.text, bold());
    cv.text('KNOB: THROTTLE', 48, 102, 20, C.dim, bold());
    cv.text(String(Math.floor(g.score)), W / 2, 92, 64, C.text, num({ align: 'center' }));
    if (view.best != null) cv.text('BEST ' + view.best, W / 2, 120, 20, C.dim, bold({ align: 'center' }));
    const m = g.mult, mc = m >= 6 ? C.zoneHot : m >= 3 ? C.zone : C.text;
    cv.text('x' + m, W - 250, 92, 40, g.state === 'play' ? mc : C.dim, bold({ align: 'right' }));
    if (g.lost > 0 && g.state === 'play') cv.text('MULTIPLIER LOST', W - 250, 120, 18, A(C.red, clamp01(g.lost)), bold({ align: 'right' }));
    cv.text('LEVEL', W - 48, 64, 20, C.dim, bold({ align: 'right' }));
    cv.text(String(g.level), W - 48, 100, 40, C.text, num({ align: 'right' }));
}

function gauge(cv, g) {
    const x0 = 80, x1 = W - 80, gw = x1 - x0, y = 170, h = 120;
    const X = (v) => x0 + v * gw;
    cv.roundRect(x0 - 24, y - 36, gw + 48, h + 92, 18, C.panel);
    cv.roundRect(x0, y, gw, h, 10, C.track);
    cv.roundRect(X(0.94), y, gw * 0.06, h, 10, A(C.red, 0.28));         // the red line
    const z = g.zone, jump = g.pendingJump();
    if (jump) {
        const blink = 0.5 + 0.5 * Math.sin(jump.t * 22);
        cv.strokeRoundRect(X(jump.to - z.w), y - 6, gw * z.w * 2, h + 12, 10, 3, A(C.zone, 0.35 + 0.5 * blink));
    }
    const glow = g.inside && g.state === 'play';
    if (glow) cv.roundRect(X(z.c - z.w) - 8, y - 10, gw * z.w * 2 + 16, h + 20, 14, A(C.zone, 0.22));
    cv.roundRect(X(z.c - z.w), y, gw * z.w * 2, h, 10, A(glow ? C.zoneHot : C.zone, glow ? 0.85 : 0.55));
    // the middle third (half again the points)
    const ca = glow && g.centred ? 0.9 : 0.35;
    cv.fillRect(X(z.c - z.w / 3), y + 8, gw * z.w * 2 / 3, 6, A('#ffffff', ca));
    cv.fillRect(X(z.c - z.w / 3), y + h - 14, gw * z.w * 2 / 3, 6, A('#ffffff', ca));
    // the fill up to the needle
    const n = g.needle, fh = 26;
    cv.roundRect(x0, y + h / 2 - fh / 2, Math.max(fh, gw * n), fh, fh / 2, A(n > 0.94 ? C.red : n > 0.75 ? C.fillHot : C.fill, 0.9));
    // the scale: 0 .. 8 (x 1000 rpm), a minor tick every 500
    for (let i = 0; i <= 16; i++) {
        const tx = X(i / 16), major = i % 2 === 0;
        cv.fillRect(tx - (major ? 1.5 : 1), y + h + 6, major ? 3 : 2, major ? 16 : 9, major ? C.tick : A(C.tick, 0.6));
        if (major) cv.text(String(i / 2), tx, y + h + 46, 22, i >= 15 ? C.red : C.dim, bold({ align: 'center' }));
    }
    // the needle
    const nx = X(n);
    cv.line(nx, y - 16, nx, y + h + 4, 5, C.needle);
    cv.quad([[nx - 13, y - 30], [nx + 13, y - 30], [nx, y - 12], [nx, y - 12]], C.needle);
}

function strain(cv, g) {
    const x = 80, y = 410, w = W - 160, h = 22, s = g.strain;
    cv.text('ENGINE STRAIN', x, y - 14, 20, C.dim, bold());
    cv.text(Math.round(s * 100) + ' %', x + w, y - 14, 20, s > 0.75 ? C.red : C.dim, bold({ align: 'right' }));
    cv.roundRect(x, y, w, h, h / 2, C.track);
    if (s > 0.005) {
        const col = s > 0.75 ? C.red : s > 0.45 ? C.warn : C.cool;
        const pulse = s > 0.75 && g.state === 'play' ? 0.65 + 0.35 * Math.sin(g.clock * 14) : 1;
        cv.roundRect(x, y, Math.max(h, w * s), h, h / 2, A(col, pulse));
    }
    cv.text(g.rpm() + ' rpm', W / 2, 488, 24, C.dim, num({ align: 'center' }));
}

function overlay(cv, g, view) {
    if (g.state === 'count') {
        const n = Math.max(1, 3 - Math.floor(g.t / (2.4 / 3)));
        cv.roundRect(W / 2 - 360, 150, 720, 150, 22, A('#000000', 0.72));
        cv.text(String(n), W / 2 - 200, 268, 120, C.zoneHot, num({ align: 'center' }));
        cv.text('KEEP THE NEEDLE', W / 2 + 90, 214, 30, C.text, bold({ align: 'center' }));
        cv.text('IN THE GREEN', W / 2 + 90, 252, 30, C.text, bold({ align: 'center' }));
    } else if (g.state === 'over') {
        cv.text('ENGINE BLOWN', W / 2, 396, 26, C.red, bold({ align: 'center' }));
    } else if (g.flash > 0) {
        cv.text('LEVEL ' + g.level, W / 2, 396, 26, A(C.zoneHot, clamp01(g.flash)), bold({ align: 'center' }));
    }
    if (view.paused) {
        cv.roundRect(W / 2 - 200, 190, 400, 80, 18, A('#000000', 0.8));
        cv.text('PAUSED', W / 2, 244, 36, C.warn, bold({ align: 'center' }));
    }
}

module.exports = { draw, C };
