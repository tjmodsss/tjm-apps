'use strict';
/**
 * style.js - "Night Circuit", the one look of Parked Games: the menu, the cards and every game.
 *
 * Games get it as `api.style` (they don't require it). Everything here draws with the kit's GPU
 * recorder ops only (rects, rounded rects, vertical gradients, horizontal ramps, arcs, lines,
 * quads, text, alpha), so it costs the same on the car as in the emulator.
 *
 *   palette   P.bg0 .. P.ink, the accents and the game hues (one hue per game: its menu tile,
 *             its HUD numbers, its hero object)
 *   type      T: the type scale. Labels are small caps with tracking; numbers use the num font
 *   draw      backdrop, panel, glow, glowLine, glowCircle, label, stat, meter, chip, button, countdown
 *   juice     Particles (sparks, bursts), Popups (floating "+100"), Shake, ease, flash
 *
 * Rules of the look:
 *   - Dark, deep blue-black backdrop with a faint grid; colour is light, not paint: things that
 *     matter glow in their hue, the rest stays in ink and glass.
 *   - One hue per game (G[id]) plus the shared semantic colours (good, warn, bad, gold).
 *   - Numbers big in `num`, labels small in `bold` caps with letter spacing.
 *   - Every event gets feedback: a burst, a pop, a flash or a shake. Nothing just disappears.
 */

/* ---------- palette ---------- */
const P = {
    bg0: '#05070d', bg1: '#0b1020', bg2: '#121a30',          // backdrop: top, bottom, raised
    glass: [150, 180, 255, 14], glassHi: [190, 210, 255, 34], hair: [170, 195, 255, 30],
    ink: '#eef2fb', dim: '#8892aa', faint: '#4a5470', shade: [0, 0, 0, 140],
    good: '#4ef0a0', warn: '#ffc547', bad: '#ff4766', gold: '#ffd666', cold: '#4fc3ff',
};
// one hue per game (the menu tile's art and glow, the game's hero colour)
const G = {
    'lane-runner': '#38d9ff', 'paddle-duel': '#9d7bff', 'canyon-glide': '#ffad42',
    'rev-keeper': '#ff5a3c', 'brick-breaker': '#ff4fa8', 'block-drop': '#6ff59a',
    'sketchpad': '#f7e45a', 'chess': '#2ee6c8',
};
const hue = (id) => G[id] || P.cold;

/* ---------- type scale (sizes that have every letter baked; num 64+ has digits only) ---------- */
const T = {
    micro: 15, label: 18, body: 22, title: 32, hero: 44,
    num: 40, numL: 64, numXL: 96,
};
const CAPS = { font: 'bold', spacing: 2 };

/* ---------- colour helpers ---------- */
function rgb(c) {
    if (Array.isArray(c)) return c;
    const h = c.replace('#', '');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), h.length > 6 ? parseInt(h.slice(6, 8), 16) : 255];
}
/** c with alpha a (0..1) */
function a(c, al) { const v = rgb(c); return [v[0], v[1], v[2], Math.max(0, Math.min(255, Math.round((v.length > 3 ? v[3] : 255) * al)))]; }
/** mix c1 -> c2 by k (0..1) */
function mix(c1, c2, k) { const x = rgb(c1), y = rgb(c2); return [0, 1, 2, 3].map((i) => Math.round(x[i] + ((y[i] === undefined ? 255 : y[i]) - (x[i] === undefined ? 255 : x[i])) * k)); }
const lighten = (c, k) => mix(c, '#ffffff', k);
const darken = (c, k) => mix(c, '#000000', k);

/* ---------- easing ---------- */
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const ease = {
    out: (t) => 1 - Math.pow(1 - clamp01(t), 3),
    inOut: (t) => { t = clamp01(t); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; },
    back: (t) => { t = clamp01(t); const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); },
    pulse: (ms, period) => 0.5 + 0.5 * Math.sin((ms / (period || 1000)) * Math.PI * 2),
};
/** frame-rate independent approach: v towards target, about `rate` of the way per 100 ms */
function approach(v, target, dt, rate) { return target + (v - target) * Math.pow(1 - (rate || 0.5), dt / 100); }

/* ---------- surfaces ---------- */
/**
 * The page backdrop: deep gradient, a faint grid (optionally scrolling) and a hue-tinted horizon.
 * opts: { tint, y0, y1, grid (px, 0 = none), sx, sy (grid scroll), horizon (0..1 strength) }
 */
function backdrop(cv, x, y, w, h, opts) {
    opts = opts || {};
    cv.gradientRect(x, y, w, h, [[0, P.bg0], [1, P.bg1]]);
    const tint = opts.tint;
    if (tint) cv.gradientRect(x, y + h * 0.45, w, h * 0.55, [[0, a(tint, 0)], [1, a(tint, 0.10 * (opts.horizon == null ? 1 : opts.horizon))]]);
    const g = opts.grid == null ? 64 : opts.grid;
    if (g > 0) {
        const sx = ((opts.sx || 0) % g + g) % g, sy = ((opts.sy || 0) % g + g) % g;
        const lc = [160, 190, 255, 9];
        for (let gx = x - sx; gx < x + w; gx += g) if (gx >= x) cv.fillRect(gx, y, 1, h, lc);
        for (let gy = y - sy; gy < y + h; gy += g) if (gy >= y) cv.fillRect(x, gy, w, 1, lc);
    }
}
/** Vignette: darkens the top and bottom edges of a region (keeps the eye in the middle) */
function vignette(cv, x, y, w, h, k) {
    k = k == null ? 1 : k;
    cv.gradientRect(x, y, w, 60, [[0, [0, 0, 0, Math.round(150 * k)]], [1, [0, 0, 0, 0]]]);
    cv.gradientRect(x, y + h - 60, w, 60, [[0, [0, 0, 0, 0]], [1, [0, 0, 0, Math.round(150 * k)]]]);
}
/**
 * A glass panel: a soft drop shadow, a raised gradient, a hairline border and a lit top edge.
 * opts: { r, accent (a coloured top bar), glow (0..1, an accent glow around it), fill }
 */
function panel(cv, x, y, w, h, opts) {
    opts = opts || {};
    const r = opts.r == null ? 16 : opts.r;
    cv.roundRect(x + 2, y + 8, w, h, r + 2, [0, 0, 0, 90]);
    if (opts.glow && opts.accent) glowRect(cv, x, y, w, h, r, opts.accent, opts.glow);
    cv.card(x, y, w, h, r, opts.fill || [[0, '#182038'], [1, '#0d1222']]);
    cv.strokeRoundRect(x, y, w, h, r, 1.5, opts.accent && opts.glow ? a(opts.accent, 0.5 + 0.5 * opts.glow) : P.hair);
    cv.fillRect(x + r, y + 1, w - 2 * r, 1, P.glassHi);
    if (opts.accent && opts.bar !== false) cv.roundRect(x + r, y, Math.min(w - 2 * r, opts.barW || 64), 4, 2, opts.accent);
}

/* ---------- light ---------- */
/** A soft glow around a rounded rect (stacked, widening, fading outlines) */
function glowRect(cv, x, y, w, h, r, c, k) {
    k = k == null ? 1 : k;
    const L = [[18, 0.05], [12, 0.08], [7, 0.12], [3, 0.2]];
    for (const l of L) cv.roundRect(x - l[0], y - l[0], w + 2 * l[0], h + 2 * l[0], r + l[0], a(c, l[1] * k));
}
function glowCircle(cv, cx, cy, rad, c, k) {
    k = k == null ? 1 : k;
    cv.circle(cx, cy, rad * 2.6, a(c, 0.05 * k));
    cv.circle(cx, cy, rad * 1.9, a(c, 0.09 * k));
    cv.circle(cx, cy, rad * 1.4, a(c, 0.16 * k));
    cv.circle(cx, cy, rad, c);
    cv.circle(cx - rad * 0.3, cy - rad * 0.3, rad * 0.35, a('#ffffff', 0.55));
}
/** A soft round light pool (no core): street lights, glows under objects */
function halo(cv, cx, cy, rad, c, k) {
    const al = 0.022 * (k == null ? 1 : k);
    for (let i = 0; i < 9; i++) cv.circle(cx, cy, rad * (1 - i / 10), a(c, al));
}
/**
 * A light beam that fades with distance (headlights, spotlights): from (x, y) along +x by len,
 * widening from w0 to w1, in n bands of falling alpha. dir -1 points left.
 */
function beam(cv, x, y, len, w0, w1, c, k, dir) {
    const n = 14, d = dir || 1;
    for (let i = 0; i < n; i++) {
        const f0 = i / n, f1 = (i + 1) / n, xa = x + d * len * f0, xb = x + d * len * f1;
        const ha = (w0 + (w1 - w0) * f0) / 2, hb = (w0 + (w1 - w0) * f1) / 2;
        const al = (k == null ? 1 : k) * 0.22 * Math.pow(1 - f0, 1.6);
        cv.quad([[xa, y - ha], [xb, y - hb], [xb, y + hb], [xa, y + ha]], a(c, al));
    }
}
/** A neon line: a wide faint halo, a mid glow and a bright core */
function glowLine(cv, xa, ya, xb, yb, wd, c, k) {
    k = k == null ? 1 : k;
    cv.line(xa, ya, xb, yb, wd * 5, a(c, 0.07 * k));
    cv.line(xa, ya, xb, yb, wd * 2.6, a(c, 0.18 * k));
    cv.line(xa, ya, xb, yb, wd, c);
    if (wd >= 3) cv.line(xa, ya, xb, yb, wd * 0.35, a(lighten(c, 0.7), 0.9));
}
/** A lit block (bricks, cells, paddles): hue body, lighter top, dark bottom lip, optional glow */
function block(cv, x, y, w, h, r, c, k) {
    if (k) glowRect(cv, x, y, w, h, r, c, k);
    cv.card(x, y, w, h, r, [[0, lighten(c, 0.25)], [0.5, c], [1, darken(c, 0.35)]]);
    cv.fillRect(x + r, y + 2, w - 2 * r, Math.max(1, h * 0.12), a('#ffffff', 0.35));
}

/* ---------- type ---------- */
/** Small caps label with tracking */
function label(cv, s, x, y, c, opts) {
    return cv.text(String(s).toUpperCase(), x, y, (opts && opts.size) || T.label, c || P.dim, Object.assign({}, CAPS, opts || {}, { size: undefined }));
}
/**
 * A HUD stat: a caps label over a number. opts: { size (num px), unit, align, color, glow }
 * Returns the number's width.
 */
function stat(cv, name, value, x, y, opts) {
    opts = opts || {};
    const size = opts.size || T.num, al = opts.align || 'left', col = opts.color || P.ink;
    label(cv, name, x, y - size * 0.82 - 8, opts.labelColor || P.dim, { align: al, size: T.micro });
    const s = String(value);
    if (opts.glow) cv.text(s, x, y, size, a(col, 0.25), { font: 'num', align: al });
    const w = cv.text(s, x, y, size, col, { font: 'num', align: al });
    if (opts.unit) {
        const ux = al === 'right' ? x + 6 : al === 'center' ? x + w / 2 + 6 : x + w + 6;
        cv.text(opts.unit, ux, y, Math.round(size * 0.45), P.dim, { font: 'bold' });
    }
    return w;
}
/** A capsule tag (WHEEL, PEDAL, NEW BEST ...) */
function chip(cv, s, x, y, c, opts) {
    opts = opts || {};
    const size = opts.size || 14, txt = String(s).toUpperCase();
    const w = cv.textWidth(txt, size, CAPS) + 22, h = size + 12;
    const x0 = opts.align === 'right' ? x - w : opts.align === 'center' ? x - w / 2 : x;
    if (opts.solid) cv.roundRect(x0, y, w, h, h / 2, c);
    else { cv.roundRect(x0, y, w, h, h / 2, a(c, 0.14)); cv.strokeRoundRect(x0, y, w, h, h / 2, 1.2, a(c, 0.55)); }
    cv.text(txt, x0 + w / 2, y + h / 2 + size * 0.36, size, opts.solid ? P.bg0 : c, Object.assign({ align: 'center' }, CAPS));
    return w;
}
/** A meter: a dark track, a hue fill with a lit cap. k 0..1 */
function meter(cv, x, y, w, h, k, c, opts) {
    opts = opts || {};
    k = clamp01(k);
    cv.roundRect(x, y, w, h, h / 2, [255, 255, 255, 16]);
    if (k > 0) {
        const fw = Math.max(h, w * k);
        if (opts.glow) glowRect(cv, x, y, fw, h, h / 2, c, 0.6);
        cv.rampRect(x, y, fw, h, h / 2, [darken(c, 0.3), c, lighten(c, 0.3)], x, w);
        cv.fillRect(x + h / 2, y + 1, fw - h, Math.max(1, h * 0.25), a('#ffffff', 0.3));
    }
}
/** A big centred countdown: the number springs in, a ring empties. msLeft, step (ms per number) */
function countdown(cv, cx, cy, msLeft, step, c, caption) {
    const n = Math.ceil(msLeft / step), f = 1 - (msLeft % step) / step;   // f: 0 -> 1 within a number
    const sc = 0.6 + 0.4 * ease.back(f * 2.5);
    cv.circle(cx, cy, 92, [5, 8, 16, 170]);
    cv.arc(cx, cy, 86, 92, 0, 360, a(c, 0.18));
    cv.arc(cx, cy, 86, 92, 0, 360 * (1 - f), c, { round: true });
    cv.alpha(clamp01(1.3 - f));
    cv.text(String(n), cx, cy + 36 * sc, Math.round(96 * sc), P.ink, { font: 'num', align: 'center' });
    cv.alpha(1);
    if (caption) {
        const cw = cv.textWidth(String(caption).toUpperCase(), T.label, CAPS) + 40;
        cv.roundRect(cx - cw / 2, cy + 106, cw, 36, 18, [5, 8, 16, 190]);
        label(cv, caption, cx, cy + 130, P.ink, { align: 'center', size: T.label });
    }
}

/* ---------- juice ---------- */
/** Sparks and bursts. Pooled; update(dt) and draw(cv, ox, oy) every frame. */
class Particles {
    constructor(max) { this.max = max || 240; this.p = []; }
    /** n sparks from x, y in colour c. opts: { speed, spread (deg), dir (deg, 0 = right), life, gravity, size, drag } */
    burst(x, y, c, n, opts) {
        opts = opts || {};
        const sp = opts.speed || 420, life = opts.life || 600, spread = opts.spread == null ? 360 : opts.spread, dir = opts.dir || 0;
        for (let i = 0; i < n; i++) {
            if (this.p.length >= this.max) this.p.shift();
            const ang = (dir + (Math.random() - 0.5) * spread) * Math.PI / 180, v = sp * (0.35 + Math.random() * 0.65);
            this.p.push({ x, y, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v, t: 0, life: life * (0.6 + Math.random() * 0.6),
                c: rgb(c), g: opts.gravity || 0, s: (opts.size || 3) * (0.6 + Math.random() * 0.8), drag: opts.drag == null ? 2.2 : opts.drag });
        }
    }
    update(dt) {
        const s = dt / 1000;
        this.p = this.p.filter((q) => {
            q.t += dt; if (q.t >= q.life) return false;
            const d = Math.exp(-q.drag * s);
            q.vx *= d; q.vy = q.vy * d + q.g * s;
            q.x += q.vx * s; q.y += q.vy * s;
            return true;
        });
    }
    draw(cv, ox, oy) {
        ox = ox || 0; oy = oy || 0;
        for (const q of this.p) {
            const k = 1 - q.t / q.life, al = Math.round(255 * k);
            const tail = 0.035;
            cv.line(q.x + ox - q.vx * tail, q.y + oy - q.vy * tail, q.x + ox, q.y + oy, q.s * 2.4, [q.c[0], q.c[1], q.c[2], Math.round(al * 0.25)]);
            cv.line(q.x + ox - q.vx * tail * 0.6, q.y + oy - q.vy * tail * 0.6, q.x + ox, q.y + oy, q.s, [q.c[0], q.c[1], q.c[2], al]);
        }
    }
    get count() { return this.p.length; }
}
/** Floating text: "+100", "x2", "FUEL" rise, scale in and fade */
class Popups {
    constructor() { this.p = []; }
    add(s, x, y, c, opts) { this.p.push({ s: String(s), x, y, c: c || P.ink, t: 0, life: (opts && opts.life) || 900, size: (opts && opts.size) || 32, num: /^[+\-x0-9 .,:]+$/.test(String(s)) }); }
    update(dt) { this.p = this.p.filter((q) => (q.t += dt) < q.life); }
    draw(cv, ox, oy) {
        for (const q of this.p) {
            const f = q.t / q.life, sc = 0.7 + 0.3 * ease.back(f * 4), y = q.y + (oy || 0) - 60 * ease.out(f);
            cv.alpha(clamp01((1 - f) * 2.2));
            const size = Math.round(q.size * sc), font = q.num ? 'num' : 'bold';
            cv.text(q.s, q.x + (ox || 0), y, size, a(q.c, 0.3), { font, align: 'center', spacing: 0 });
            cv.text(q.s, q.x + (ox || 0), y - 1, size, q.c, { font, align: 'center' });
            cv.alpha(1);
        }
    }
}
/** Screen shake: kick(strength px), update(dt), then offset x / y to draw the world with */
class Shake {
    constructor() { this.k = 0; this.x = 0; this.y = 0; this.t = 0; }
    kick(px) { this.k = Math.max(this.k, px); }
    update(dt) {
        this.t += dt; this.k = Math.max(0, this.k * Math.pow(0.0015, dt / 1000) - dt * 0.002);
        this.x = Math.sin(this.t * 0.091) * this.k; this.y = Math.cos(this.t * 0.067) * this.k * 0.7;
    }
}
/** A full-region flash (hit = bad, pick-up = the hue): k 0..1 */
function flash(cv, x, y, w, h, c, k) { if (k > 0) cv.fillRect(x, y, w, h, a(c, 0.35 * k)); }

module.exports = {
    P, G, T, hue, rgb, a, mix, lighten, darken, ease, approach, clamp01,
    backdrop, vignette, panel, halo, beam, glowRect, glowCircle, glowLine, block,
    label, stat, chip, meter, countdown, flash, Particles, Popups, Shake,
};
