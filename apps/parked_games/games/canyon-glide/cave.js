'use strict';
/**
 * cave.js - Canyon Glide: the cave the glider flies through.
 *
 * The cave is a strip of samples, one every SEG world px: each has a centre line and a half gap
 * (ceiling = centre - gap, floor = centre + gap). The centre wanders with a smoothed random walk;
 * the gap narrows with difficulty. On top of that come spires (rock teeth from the ceiling or the
 * floor, as triangles) and crystals (pickups). Everything is seeded, so a seed gives the same cave.
 *
 * Plain Node 8 JavaScript, no kit dependency: the game and the tests use it alike.
 */

const SEG = 40;                 // world px between samples
const H = 520;                  // screen height
const MARGIN = 26;              // rock always at least this thick at the top and bottom

/** mulberry32: small seeded PRNG, returns 0..1 */
function rng(seed) {
    let a = (seed >>> 0) || 1;
    return function () {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, k) => a + (b - a) * k;

/** difficulty 0..1 from distance flown (world px): full after ~3.25 km of cave */
function difficulty(x) { return clamp(x / 130000, 0, 1); }

/** half gap at difficulty d */
function gapAt(d) { return lerp(168, 98, d); }

class Cave {
    constructor(seed) {
        this.rand = rng(seed);
        this.base = 0;              // index of samples[0]
        this.samples = [];          // { c, g }
        this.spires = [];           // { x, y0, tipX, tipY, w, top }  world coordinates; base at the rock edge
        this.crystals = [];         // { x, y, taken }
        this.c = H / 2; this.target = H / 2; this.vel = 0; this.wob = 0;
        this.nextTurn = 0;
        this.nextSpire = 1400; this.nextCrystal = 900;
        this.gen(0, 2400);
    }

    /** generate samples up to world x `to` */
    gen(from, to) {
        const r = this.rand;
        while ((this.base + this.samples.length) * SEG <= to) {
            const i = this.base + this.samples.length, x = i * SEG, d = difficulty(x);
            // the gap breathes a little (smoothed, so the walls stay smooth)
            this.wob = this.wob * 0.85 + (r() - 0.5) * 0.15;
            const g = Math.max(gapAt(1) - 8, gapAt(d) + this.wob * 60 * (1 - d * 0.5));
            // the first 1200 px stay straight and wide: time to settle in
            if (x < 1200) { this.samples.push({ c: H / 2, g: Math.max(g, 190) }); continue; }
            if (i >= this.nextTurn) {
                const room = H / 2 - g - MARGIN;
                const swing = lerp(0.75, 1, d) * room;
                this.target = H / 2 + (r() * 2 - 1) * swing;
                this.nextTurn = i + 5 + Math.floor(r() * lerp(11, 6, d));
            }
            // springy follow: the walls bend smoothly, sharper with difficulty
            const k = lerp(0.025, 0.05, d);
            this.vel = this.vel * 0.86 + (this.target - this.c) * k;
            this.c += this.vel;
            this.c = clamp(this.c, g + MARGIN, H - g - MARGIN);
            this.samples.push({ c: this.c, g: g });
        }
        this.genThings(to);
    }

    genThings(to) {
        const r = this.rand;
        while (this.nextSpire < to) {
            const x = this.nextSpire, d = difficulty(x), s = this.at(x);
            // no spires where the cave bends hard: the wall would close in right behind them
            if (this.samples.length * SEG + this.base * SEG < x + 200) break;
            if (Math.abs(this.at(x + 160).c - this.at(x - 160).c) > 70) { this.nextSpire += 160; continue; }
            const top = r() < 0.5;
            // a spire reaches at most this far into the gap, always leaving room to pass
            const reach = (s.floor - s.ceil) * lerp(0.28, 0.5, d) * (0.6 + r() * 0.4);
            const w = 70 + r() * 60;
            if (top) this.spires.push({ x: x, top: true, w: w, tipX: x + (r() - 0.5) * 20, tipY: s.ceil + reach });
            else this.spires.push({ x: x, top: false, w: w, tipX: x + (r() - 0.5) * 20, tipY: s.floor - reach });
            this.nextSpire = x + lerp(1100, 420, d) + r() * lerp(900, 380, d);
        }
        while (this.nextCrystal < to) {
            const x = this.nextCrystal, s = this.at(x);
            // keep crystals clear of spires so taking one is always possible
            const near = this.spires.some((p) => Math.abs(p.x - x) < 110);
            if (!near) this.crystals.push({ x: x, y: lerp(s.ceil + 40, s.floor - 40, r()), taken: false });
            this.nextCrystal = x + 520 + r() * 900;
        }
    }

    /** ceiling and floor y at world x (linear between samples) */
    at(x) {
        const fi = x / SEG - this.base;
        let i = Math.floor(fi);
        if (i < 0) i = 0;
        if (i >= this.samples.length - 1) i = this.samples.length - 2;
        const a = this.samples[i], b = this.samples[i + 1], k = clamp(fi - i, 0, 1);
        const c = lerp(a.c, b.c, k), g = lerp(a.g, b.g, k);
        return { ceil: c - g, floor: c + g, c: c, g: g };
    }

    /** keep the window [x0, x1] generated, drop what's behind x0 */
    window(x0, x1) {
        this.gen(x0, x1 + SEG * 2);
        const drop = Math.floor(x0 / SEG) - this.base - 2;
        if (drop > 0) { this.samples.splice(0, drop); this.base += drop; }
        if (this.spires.length && this.spires[0].x + 200 < x0) this.spires = this.spires.filter((p) => p.x + 200 >= x0);
        if (this.crystals.length && this.crystals[0].x + 60 < x0) this.crystals = this.crystals.filter((c) => c.x + 60 >= x0);
    }

    /** the spire's triangle as three [x, y] points (world) */
    tri(p) {
        const b0 = this.at(p.x - p.w / 2), b1 = this.at(p.x + p.w / 2);
        // the base sits a bit inside the rock so it joins the wall without a seam
        if (p.top) return [[p.x - p.w / 2, b0.ceil - 30], [p.x + p.w / 2, b1.ceil - 30], [p.tipX, p.tipY]];
        return [[p.x - p.w / 2, b0.floor + 30], [p.x + p.w / 2, b1.floor + 30], [p.tipX, p.tipY]];
    }
}

/** distance from point to segment */
function segDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
    const t = l ? clamp(((px - ax) * dx + (py - ay) * dy) / l, 0, 1) : 0;
    const x = ax + dx * t - px, y = ay + dy * t - py;
    return Math.sqrt(x * x + y * y);
}

/** does a circle (x, y, r) touch triangle t? */
function circleHitsTri(x, y, r, t) {
    const s = (a, b) => (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
    const d1 = s(t[0], t[1]), d2 = s(t[1], t[2]), d3 = s(t[2], t[0]);
    const inside = !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
    if (inside) return true;
    return segDist(x, y, t[0][0], t[0][1], t[1][0], t[1][1]) < r ||
        segDist(x, y, t[1][0], t[1][1], t[2][0], t[2][1]) < r ||
        segDist(x, y, t[2][0], t[2][1], t[0][0], t[0][1]) < r;
}

module.exports = { Cave, SEG, H, rng, clamp, lerp, difficulty, gapAt, circleHitsTri, segDist };
