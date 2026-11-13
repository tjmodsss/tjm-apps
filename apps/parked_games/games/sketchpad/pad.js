'use strict';
/**
 * pad.js - the Sketchpad's page, with no drawing: strokes, undo, clear, the point budget and saving.
 *
 *   const p = new Pad(rect)        rect = the paper { x, y, w, h } in canvas px
 *   p.begin(x, y, colour, size)    a new stroke (a finger down, or the knob pen put down)
 *   p.add(x, y)                    the stroke goes on (points closer than MIN_STEP are skipped)
 *   p.end()                        the stroke is finished: simplified and kept (true when kept)
 *   p.undo()                       takes back the last stroke, or the last Clear
 *   p.clear()                      empties the page (Undo brings it back)
 *   p.save() / Pad.load(v, rect)   a compact JSON value for api.store
 *
 * A stroke is { c, s, p }: c = colour index (COLOURS, RAINBOW, ERASER), s = size index (SIZES),
 * p = flat [x0, y0, x1, y1, ...] in whole canvas px. The whole page keeps at most MAX_POINTS
 * points, so a frame never holds more than a few thousand lines.
 */

const COLOURS = ['#ff4d5e', '#ff9a3c', '#ffe14f', '#5ef08a', '#3fd8ff', '#5b7cff', '#b06bff', '#f4f6ff'];
const NAMES = ['Red', 'Orange', 'Yellow', 'Green', 'Sky', 'Blue', 'Purple', 'White'];
const RAINBOW = COLOURS.length;          // 8: the colour changes along the stroke
const ERASER = COLOURS.length + 1;       // 9: paints the paper back
const SIZES = [6, 14, 30];               // line widths in px
const MAX_POINTS = 4000;
const MIN_STEP = 4;                      // px between kept points while drawing
const SIMPLIFY = 1.2;                    // px: how far simplifying may move the line
const MAX_CLEARS = 3;                    // how many Clears Undo can bring back

/** Ramer-Douglas-Peucker on a flat point list: drops the points that lie within eps of the line. */
function simplify(p, eps) {
    const n = p.length / 2;
    if (n <= 2) return p.slice();
    const keep = new Uint8Array(n);
    keep[0] = keep[n - 1] = 1;
    const stack = [[0, n - 1]];
    while (stack.length) {
        const s = stack.pop(), a = s[0], b = s[1];
        const ax = p[2 * a], ay = p[2 * a + 1], bx = p[2 * b], by = p[2 * b + 1];
        const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
        let far = -1, fd = eps * eps;
        for (let i = a + 1; i < b; i++) {
            const px = p[2 * i], py = p[2 * i + 1];
            let d2;
            if (len2 === 0) d2 = (px - ax) * (px - ax) + (py - ay) * (py - ay);
            else {
                const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
                const qx = ax + t * dx - px, qy = ay + t * dy - py;
                d2 = qx * qx + qy * qy;
            }
            if (d2 > fd) { fd = d2; far = i; }
        }
        if (far >= 0) { keep[far] = 1; stack.push([a, far], [far, b]); }
    }
    const out = [];
    for (let i = 0; i < n; i++) if (keep[i]) out.push(p[2 * i], p[2 * i + 1]);
    return out;
}

class Pad {
    constructor(rect) {
        this.rect = rect;
        this.strokes = [];
        this.history = [];      // 'S' per kept stroke, or { clear: strokes } for a Clear
        this.cur = null;        // the stroke being drawn
        this.points = 0;        // points in the kept strokes
        this.full = false;      // the last stroke hit MAX_POINTS
        this.changed = 0;       // counts changes (for saving)
    }
    /** a point clamped onto the paper, in whole px */
    clamp(x, y) {
        const r = this.rect;
        return [Math.round(Math.max(r.x, Math.min(r.x + r.w, x))), Math.round(Math.max(r.y, Math.min(r.y + r.h, y)))];
    }
    inside(x, y) { const r = this.rect; return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h; }
    room() { return MAX_POINTS - this.points - (this.cur ? this.cur.p.length / 2 : 0); }

    begin(x, y, c, s) {
        if (this.cur) this.end();
        if (this.room() < 1) { this.full = true; return false; }
        const q = this.clamp(x, y);
        this.cur = { c, s, p: [q[0], q[1]] };
        this.full = false;
        return true;
    }
    add(x, y) {
        const k = this.cur;
        if (!k) return false;
        const q = this.clamp(x, y), n = k.p.length;
        const dx = q[0] - k.p[n - 2], dy = q[1] - k.p[n - 1];
        if (dx * dx + dy * dy < MIN_STEP * MIN_STEP) return false;
        if (this.room() < 1) { this.full = true; return false; }
        k.p.push(q[0], q[1]);
        return true;
    }
    end() {
        const k = this.cur;
        this.cur = null;
        if (!k) return false;
        k.p = simplify(k.p, SIMPLIFY);
        this.strokes.push(k);
        this.history.push('S');
        this.points += k.p.length / 2;
        this.changed++;
        return true;
    }
    /** the last change taken back: 'stroke', 'clear' or null (nothing to undo) */
    undo() {
        if (this.cur) { this.cur = null; return 'stroke'; }
        const h = this.history.pop();
        if (h === undefined) return null;
        if (h === 'S') {
            const k = this.strokes.pop();
            if (k) this.points -= k.p.length / 2;
        } else {
            // the page comes back, and its strokes can be taken back one by one again
            this.strokes = h.clear.concat(this.strokes);
            h.clear.forEach(() => this.history.push('S'));
            this.points = this.count();
        }
        this.full = false;
        this.changed++;
        return h === 'S' ? 'stroke' : 'clear';
    }
    clear() {
        if (this.cur) this.end();
        if (!this.strokes.length) return false;
        this.history = this.history.filter((h) => h !== 'S');
        this.history.push({ clear: this.strokes });
        // keep only the newest few Clears in memory
        const clears = this.history.filter((h) => h !== 'S');
        if (clears.length > MAX_CLEARS) this.history.splice(this.history.indexOf(clears[0]), 1);
        this.strokes = [];
        this.points = 0;
        this.full = false;
        this.changed++;
        return true;
    }
    empty() { return !this.strokes.length && !this.cur; }
    count() { return this.strokes.reduce((n, k) => n + k.p.length / 2, 0); }

    /** the page as a JSON value (the Clears in the undo history are not saved) */
    save() { return { v: 1, k: this.strokes.map((k) => [k.c, k.s, k.p]) }; }
    static load(v, rect) {
        const pad = new Pad(rect);
        if (!v || v.v !== 1 || !Array.isArray(v.k)) return pad;
        v.k.forEach((a) => {
            if (!Array.isArray(a) || !Array.isArray(a[2]) || a[2].length < 2 || a[2].length % 2) return;
            const c = a[0] | 0, s = a[1] | 0;
            if (c < 0 || c > ERASER || s < 0 || s >= SIZES.length) return;
            const p = a[2].map((n) => Math.round(Number(n) || 0));
            if (pad.points + p.length / 2 > MAX_POINTS) return;
            pad.strokes.push({ c, s, p });
            pad.history.push('S');
            pad.points += p.length / 2;
        });
        return pad;
    }
}

module.exports = { Pad, simplify, COLOURS, NAMES, RAINBOW, ERASER, SIZES, MAX_POINTS, MIN_STEP };
