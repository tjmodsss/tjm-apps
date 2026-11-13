'use strict';
/**
 * Sketchpad - a drawing pad for the passengers (and the kids in the back, when the screen is in reach).
 * No score and no end: the page is kept (api.store) and is there again next time.
 *
 * Controls
 *   touch            draw with a finger on the paper; tap a colour, a size, Undo or Clear
 *   turn the knob    (tools) move between the colours, sizes, Undo and Clear; press to pick
 *   push             (tools) up / down / left / right between the tools; right from the right
 *                    column puts the knob pen on the paper
 *   knob pen         hold a push to move the pen, turn for fine steps along that way, press to
 *                    put the pen down / lift it; push left at the paper's left edge = back to the tools
 *   Clear            asks once ("Sure?"); Undo brings a cleared page back too
 *
 * The page: pad.js (no drawing). Drawn in the shell's look (api.style): neon ink on night paper.
 */
const { Pad, COLOURS, NAMES, RAINBOW, ERASER, SIZES } = require('./pad');

const W = 1600, H = 520;
const HUE = '#f7e45a';
const PAPER = { x: 260, y: 52, w: 1324, h: 452 };
const INK = '#0a0f1e';                    // the paper's colour (the eraser paints it back)

// the tools on the left: 10 swatches (2 x 5), 3 sizes, Undo and Clear
const TOOLS = [];
(function layout() {
    const x0 = 16, y0 = 52, sw = 108, sh = 58, gap = 8;
    for (let i = 0; i <= ERASER; i++) TOOLS.push({ kind: 'colour', v: i, x: x0 + (i % 2) * (sw + gap), y: y0 + Math.floor(i / 2) * (sh + gap), w: sw, h: sh });
    const zw = 69;
    for (let i = 0; i < SIZES.length; i++) TOOLS.push({ kind: 'size', v: i, x: x0 + i * (zw + 8), y: 384, w: zw, h: 56 });
    TOOLS.push({ kind: 'undo', x: x0, y: 448, w: sw, h: 56 });
    TOOLS.push({ kind: 'clear', x: x0 + sw + gap, y: 448, w: sw, h: 56 });
})();
// rows of tool indices, for pushing up / down / left / right
const ROWS = [[0, 1], [2, 3], [4, 5], [6, 7], [8, 9], [10, 11, 12], [13, 14]];
const rowOf = (i) => ROWS.findIndex((r) => r.indexOf(i) >= 0);

/** colour i (0..1 along) of the rainbow pen */
const RAIN = [];
for (let i = 0; i < 48; i++) {
    const h = i / 48 * 6, k = h - Math.floor(h), f = [
        [1, k, 0], [1 - k, 1, 0], [0, 1, k], [0, 1 - k, 1], [k, 0, 1], [1, 0, 1 - k]][Math.floor(h)];
    RAIN.push([Math.round(90 + 165 * f[0]), Math.round(90 + 165 * f[1]), Math.round(90 + 165 * f[2]), 255]);
}
const rain = (n) => RAIN[((n % RAIN.length) + RAIN.length) % RAIN.length];

const SAVE_KEY = 'page';
const PEN_SLOW = 200, PEN_FAST = 620, PEN_RAMP = 700;  // knob pen speed (px/s) while a push is held
const KNOB_STEP = 8;                                    // knob pen px per click

class Game {
    constructor(api) {
        this.api = api;
        this.S = api.style || null;
        let saved = null;
        try { saved = api.store && api.store.get(SAVE_KEY); } catch (e) { saved = null; }
        this.pad = Pad.load(saved, PAPER);
        this.savedAt = this.pad.changed;
        const prefs = (saved && saved.tool) || {};
        this.colour = prefs.c >= 0 && prefs.c <= ERASER ? prefs.c : 4;
        this.size = prefs.s >= 0 && prefs.s < SIZES.length ? prefs.s : 1;
        this.t = 0;
        this.zone = 'tools';     // where the knob is: 'tools' or 'pen'
        this.focus = this.colour;
        this.knobUsed = false;   // show the knob's focus ring only once the knob is used
        this.finger = false;     // a finger is drawing
        this.pen = { x: PAPER.x + PAPER.w / 2, y: PAPER.y + PAPER.h / 2, down: false, dir: 'E', held: null, heldT: 0 };
        this.sure = 0;           // ms left of "Clear? Sure?"
        this.pressed = -1; this.pressedT = 0;   // the tool last tapped / picked, for a flash
        this.say = null;         // { s, t }: a short message over the paper
        this.fx = this.S ? new this.S.Particles(200) : null;
    }

    /* ---------- the tools ---------- */
    use(i) {
        const tl = TOOLS[i];
        if (!tl) return;
        this.pressed = i; this.pressedT = this.t;
        if (tl.kind === 'colour') { this.colour = tl.v; this.focus = i; this.saveSoon(); }
        else if (tl.kind === 'size') { this.size = tl.v; this.focus = i; this.saveSoon(); }
        else if (tl.kind === 'undo') {
            this.endStroke();
            const u = this.pad.undo();
            this.tell(u === 'clear' ? 'Page back' : u ? null : 'Nothing to undo');
            this.sure = 0;
        } else if (tl.kind === 'clear') {
            this.endStroke();
            if (this.pad.empty()) { this.tell('The page is empty'); return; }
            if (this.sure <= 0) { this.sure = 2600; return; }
            this.sure = 0;
            this.pad.clear();
            this.tell('Cleared: Undo brings it back');
            if (this.fx) for (let k = 0; k < 6; k++) this.fx.burst(PAPER.x + PAPER.w * (k + 0.5) / 6, PAPER.y + PAPER.h / 2, COLOURS[k], 18, { speed: 520, life: 650 });
        }
        if (tl.kind !== 'clear') this.sure = 0;
        this.save();
    }
    toolAt(x, y) { return TOOLS.findIndex((t) => x >= t.x && x < t.x + t.w && y >= t.y && y < t.y + t.h); }
    tell(s) { this.say = s ? { s, t: this.t } : null; }

    /* ---------- strokes ---------- */
    startStroke(x, y) {
        this.sure = 0;
        if (!this.pad.begin(x, y, this.colour, this.size)) this.tell('The page is full: Clear or Undo');
    }
    endStroke() {
        if (this.pad.cur) { this.pad.end(); this.save(); }
        this.finger = false;
        this.pen.down = false;
    }
    save() {
        if (this.pad.changed === this.savedAt && !this.toolDirty) return;
        this.savedAt = this.pad.changed; this.toolDirty = false;
        try {
            if (this.api.store) this.api.store.set(SAVE_KEY, Object.assign(this.pad.save(), { tool: { c: this.colour, s: this.size } }));
        } catch (e) { if (this.api.log) this.api.log.warn('sketchpad: not saved', e); }
    }
    saveSoon() { this.toolDirty = true; }

    /* ---------- the knob pen ---------- */
    penTo(x, y) {
        const p = this.pen, q = this.pad.clamp(x, y);
        p.x = q[0]; p.y = q[1];
        if (p.down) {
            if (!this.pad.cur) this.startStroke(p.x, p.y);
            else this.pad.add(p.x, p.y);
        }
    }
    penStep(dir, px) {
        const d = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] }[dir];
        if (d) this.penTo(this.pen.x + d[0] * px, this.pen.y + d[1] * px);
    }
    toPen() {
        this.zone = 'pen';
        this.pen.down = false; this.pen.held = null;
        this.pen.x = Math.max(this.pen.x, PAPER.x + 24);
    }
    toTools() { this.endStroke(); this.zone = 'tools'; this.pen.held = null; }

    /* ---------- input ---------- */
    input(ev) {
        if (!ev) return;
        if (ev.type === 'touch') return this.touch(ev);
        if (ev.type === 'tap') return;              // handled as touch down / up
        if (ev.type === 'knob' || ev.type === 'press' || ev.type === 'push') this.knobUsed = true;
        if (this.zone === 'pen') return this.penInput(ev);
        if (ev.type === 'knob') {
            const n = TOOLS.length;
            this.focus = ((this.focus + (ev.delta | 0)) % n + n) % n;
        } else if (ev.type === 'press') this.use(this.focus);
        else if (ev.type === 'push') {
            const r = rowOf(this.focus), row = ROWS[r], col = row.indexOf(this.focus);
            if (ev.dir === 'N' || ev.dir === 'S') {
                const to = ROWS[(r + (ev.dir === 'N' ? -1 : 1) + ROWS.length) % ROWS.length];
                this.focus = to[Math.min(to.length - 1, Math.round(col * (to.length - 1) / Math.max(1, row.length - 1)))];
            } else if (ev.dir === 'W') { if (col > 0) this.focus = row[col - 1]; }
            else if (ev.dir === 'E') { if (col < row.length - 1) this.focus = row[col + 1]; else this.toPen(); }
        }
    }
    penInput(ev) {
        const p = this.pen;
        if (ev.type === 'knob') this.penStep(p.dir, (ev.delta | 0) * KNOB_STEP);
        else if (ev.type === 'press') {
            if (p.down) this.endStroke();
            else { p.down = true; this.startStroke(p.x, p.y); if (!this.pad.cur) p.down = false; }
        } else if (ev.type === 'push') {
            if (ev.dir === 'W' && p.x <= PAPER.x + 1) { this.toTools(); return; }
            p.dir = ev.dir; p.held = ev.dir; p.heldT = 0;
            this.penStep(ev.dir, 2);
        } else if (ev.type === 'release') p.held = null;
    }
    touch(ev) {
        const x = ev.x, y = ev.y;
        if (ev.phase === 'down') {
            if (this.finger) this.endStroke();
            if (this.pad.inside(x, y)) {
                if (this.zone === 'pen') this.toTools();
                this.finger = true;
                this.startStroke(x, y);
                if (!this.pad.cur) this.finger = false;
            } else {
                const i = this.toolAt(x, y);
                if (i >= 0) { this.focus = i; this.use(i); }
            }
        } else if (ev.phase === 'move') {
            if (this.finger) this.pad.add(x, y);
        } else if (ev.phase === 'up') {
            if (this.finger) { this.pad.add(x, y); this.endStroke(); }
        }
    }

    update(dt) {
        this.t += dt;
        this.sure = Math.max(0, this.sure - dt);
        const p = this.pen;
        if (this.zone === 'pen' && p.held) {
            p.heldT += dt;
            const v = PEN_SLOW + (PEN_FAST - PEN_SLOW) * Math.min(1, p.heldT / PEN_RAMP);
            this.penStep(p.held, v * dt / 1000);
        }
        if (this.pad.full && this.pad.cur && (!this.say || this.t - this.say.t > 2500)) this.tell('The page is full: Clear or Undo');
        if (this.fx) this.fx.update(dt);
        if (this.toolDirty && !this.pad.cur) this.save();
    }
    pause() { this.endStroke(); this.pen.held = null; this.save(); }
    resume() { this.pen.held = null; }

    /* ---------- drawing ---------- */
    draw(cv) {
        const S = this.S;
        if (S) S.backdrop(cv, 0, 44, W, H - 44, { tint: HUE, grid: 0, horizon: 0.6 });
        else cv.fillRect(0, 44, W, H - 44, '#05070d');
        this.paper(cv);
        this.toolbar(cv);
    }
    paper(cv) {
        const S = this.S, r = PAPER, pad = this.pad;
        if (S) S.glowRect(cv, r.x, r.y, r.w, r.h, 14, HUE, 0.25);
        cv.roundRect(r.x, r.y, r.w, r.h, 14, INK);
        cv.clip(r.x, r.y, r.w, r.h);
        // a faint dot grid, a guide for little hands
        for (let gx = r.x + 44; gx < r.x + r.w; gx += 88) for (let gy = r.y + 38; gy < r.y + r.h; gy += 76) cv.fillRect(gx - 1, gy - 1, 2, 2, [160, 190, 255, 22]);
        if (pad.empty()) {
            cv.text('Draw something!', r.x + r.w / 2, r.y + r.h / 2 - 6, 40, [238, 242, 251, 60], { font: 'bold', align: 'center' });
            const hint = this.knobUsed ? 'with a finger, or push right to draw with the knob' : 'with a finger on the screen, or with the knob';
            cv.text(hint, r.x + r.w / 2, r.y + r.h / 2 + 34, 20, [136, 146, 170, 120], { font: 'label', align: 'center' });
        }
        pad.strokes.forEach((k) => this.stroke(cv, k));
        if (pad.cur) this.stroke(cv, pad.cur);
        if (this.zone === 'pen') this.penCursor(cv);
        if (this.fx) this.fx.draw(cv, 0, 0);
        cv.noclip();
        cv.strokeRoundRect(r.x, r.y, r.w, r.h, 14, 1.5, S ? S.a(HUE, 0.35) : [255, 255, 255, 40]);
        // messages and the knob pen's help, along the paper's bottom
        if (this.zone === 'pen') this.chip(cv, this.pen.down ? 'Pen down: push or turn to draw, press to lift' : 'Pen up: push to move, press to draw, left edge: tools', r.x + 16, r.y + r.h - 40, this.pen.down ? HUE : '#8892aa');
        if (this.say && this.t - this.say.t < 2600) this.chip(cv, this.say.s, r.x + r.w - 16, r.y + 14, '#eef2fb', 'right');
    }
    chip(cv, s, x, y, c, align) {
        if (this.S) {
            // on a solid dark backing, so it reads over the drawing
            const w = cv.textWidth(String(s).toUpperCase(), 14, { font: 'bold', spacing: 2 }) + 22, x0 = align === 'right' ? x - w : x;
            cv.roundRect(x0 - 3, y - 3, w + 6, 32, 16, [5, 8, 16, 230]);
            this.S.chip(cv, s, x, y, c, { size: 14, align });
        }
        else cv.text(s, x, y + 18, 18, c, { font: 'label', align: align || 'left' });
    }
    /** one stroke: a soft glow under a bright core (the eraser: paper, no glow) */
    stroke(cv, k) {
        const p = k.p, w = SIZES[k.s] || 14, n = p.length / 2;
        if (k.c === ERASER) {
            const ew = w * 1.6 + 12;
            if (n === 1) cv.circle(p[0], p[1], ew / 2, INK);
            for (let i = 1; i < n; i++) cv.line(p[2 * i - 2], p[2 * i - 1], p[2 * i], p[2 * i + 1], ew, INK);
            return;
        }
        const S = this.S, rainbow = k.c === RAINBOW;
        const col = rainbow ? null : COLOURS[k.c] || COLOURS[0];
        const glow = S ? S.a(col || '#ffffff', 0.11) : null, gw = w + 14;
        if (n === 1) {
            const c = rainbow ? rain(0) : col;
            if (glow) cv.circle(p[0], p[1], gw / 2, rainbow ? S.a(c, 0.13) : glow);
            cv.circle(p[0], p[1], w / 2, c);
            return;
        }
        if (glow && !rainbow) for (let i = 1; i < n; i++) cv.line(p[2 * i - 2], p[2 * i - 1], p[2 * i], p[2 * i + 1], gw, glow);
        for (let i = 1; i < n; i++) cv.line(p[2 * i - 2], p[2 * i - 1], p[2 * i], p[2 * i + 1], w, rainbow ? rain(i) : col);
    }
    penCursor(cv) {
        const S = this.S, p = this.pen, w = SIZES[this.size], c = this.colour === RAINBOW ? rain(Math.floor(this.t / 60)) : this.colour === ERASER ? '#eef2fb' : COLOURS[this.colour];
        const rad = Math.max(10, (this.colour === ERASER ? w * 1.6 + 12 : w) / 2 + 6), pulse = 0.5 + 0.5 * Math.sin(this.t / 180);
        cv.arc(p.x, p.y, rad, rad + 2.5, 0, 360, c);
        if (p.down) cv.circle(p.x, p.y, Math.max(3, w / 2), c);
        else {
            cv.arc(p.x, p.y, rad + 6, rad + 7, 0, 360, S ? S.a(c, 0.25 + 0.35 * pulse) : c);
            cv.line(p.x - rad - 14, p.y, p.x - rad - 4, p.y, 2, c); cv.line(p.x + rad + 4, p.y, p.x + rad + 14, p.y, 2, c);
            cv.line(p.x, p.y - rad - 14, p.x, p.y - rad - 4, 2, c); cv.line(p.x, p.y + rad + 4, p.x, p.y + rad + 14, 2, c);
        }
    }
    toolbar(cv) {
        const S = this.S;
        if (S) S.panel(cv, 8, 46, 244, 466, { r: 16 });
        TOOLS.forEach((tl, i) => {
            const flash = i === this.pressed ? Math.max(0, 1 - (this.t - this.pressedT) / 260) : 0;
            const sel = (tl.kind === 'colour' && tl.v === this.colour) || (tl.kind === 'size' && tl.v === this.size);
            if (tl.kind === 'colour') this.swatch(cv, tl, sel, flash);
            else this.button(cv, tl, sel, flash);
            if (this.zone === 'tools' && this.knobUsed && i === this.focus) {
                const pulse = 0.6 + 0.4 * Math.sin(this.t / 200);
                if (S) S.glowRect(cv, tl.x, tl.y, tl.w, tl.h, 12, HUE, 0.5 * pulse);
                cv.strokeRoundRect(tl.x - 4, tl.y - 4, tl.w + 8, tl.h + 8, 14, 2.5, HUE);
            }
        });
    }
    swatch(cv, tl, sel, flash) {
        const S = this.S, x = tl.x, y = tl.y, w = tl.w, h = tl.h;
        if (tl.v === ERASER) {
            cv.roundRect(x, y, w, h, 12, '#1a2238');
            cv.roundRect(x + 30, y + 8, 48, 24, 6, '#eef2fb');
            cv.roundRect(x + 30, y + 8, 18, 24, 6, '#ff8fa3');
            cv.text('Eraser', x + w / 2, y + h - 5, 13, '#8892aa', { font: 'label', align: 'center' });
        } else if (tl.v === RAINBOW) {
            const n = 12;
            cv.clip(x, y, w, h);
            for (let i = 0; i < n; i++) cv.fillRect(x + i * w / n, y, w / n + 1, h, rain(i * 4 + Math.floor(this.t / 120)));
            cv.noclip();
            cv.strokeRoundRect(x, y, w, h, 12, 4, '#0b1020');
        } else {
            const c = COLOURS[tl.v];
            if (S && sel) S.glowRect(cv, x, y, w, h, 12, c, 0.7);
            if (S) S.block(cv, x, y, w, h, 12, c, 0); else cv.roundRect(x, y, w, h, 12, c);
        }
        if (flash) cv.roundRect(x, y, w, h, 12, [255, 255, 255, Math.round(120 * flash)]);
        if (sel) {
            cv.strokeRoundRect(x - 1, y - 1, w + 2, h + 2, 13, 3, '#ffffff');
            cv.circle(x + w - 14, y + 14, 9, '#0b1020');
            cv.line(x + w - 18, y + 14, x + w - 15, y + 18, 2.5, '#ffffff'); cv.line(x + w - 15, y + 18, x + w - 9, y + 10, 2.5, '#ffffff');
        }
    }
    button(cv, tl, sel, flash) {
        const S = this.S, x = tl.x, y = tl.y, w = tl.w, h = tl.h;
        const warn = tl.kind === 'clear' && this.sure > 0;
        const edge = warn ? '#ffffff' : sel ? HUE : [170, 195, 255, 40];
        cv.roundRect(x, y, w, h, 12, warn ? '#ff4766' : sel ? [247, 228, 90, 30] : [150, 180, 255, 14]);
        cv.strokeRoundRect(x, y, w, h, 12, sel || warn ? 2 : 1.5, edge);
        if (flash) cv.roundRect(x, y, w, h, 12, [255, 255, 255, Math.round(90 * flash)]);
        const cx = x + w / 2, cy = y + h / 2;
        if (tl.kind === 'size') {
            const c = this.colour === RAINBOW ? rain(tl.v * 10) : this.colour === ERASER ? '#eef2fb' : COLOURS[this.colour];
            cv.circle(cx, cy, Math.max(3, SIZES[tl.v] / 2), c);
            return;
        }
        if (tl.kind === 'undo') {
            // an arrow that turns back: a half circle on the right, the arrowhead pointing left
            const ox = cx + 4, oy = cy - 7, r = 9, pts = [];
            for (let a = -90; a <= 90; a += 15) pts.push([ox + r * Math.cos(a * Math.PI / 180), oy + r * Math.sin(a * Math.PI / 180)]);
            cv.polyline(pts, 3, '#eef2fb');
            cv.line(ox, oy + r, ox - 10, oy + r, 3, '#eef2fb');
            cv.line(ox, oy - r, ox - 6, oy - r, 3, '#eef2fb');
            cv.quad([[ox - 14, oy - r], [ox - 6, oy - r - 6], [ox - 6, oy - r + 6], [ox - 6, oy - r + 6]], '#eef2fb');
            cv.text('Undo', cx, y + h - 5, 13, '#8892aa', { font: 'label', align: 'center' });
            return;
        }
        // clear: a sheet with a cross, or the question
        if (warn) {
            cv.text('Sure?', cx, cy + 8, 24, '#ffffff', { font: 'bold', align: 'center' });
            return;
        }
        cv.roundRect(cx - 10, cy - 22, 20, 24, 3, '#eef2fb');
        cv.line(cx - 5, cy - 15, cx + 5, cy - 5, 3, '#0b1020'); cv.line(cx + 5, cy - 15, cx - 5, cy - 5, 3, '#0b1020');
        cv.text('Clear', cx, y + h - 5, 13, '#8892aa', { font: 'label', align: 'center' });
    }
}

/** The menu tile's scene: neon scribbles drawing themselves on a little page */
function art(cv, x, y, w, h, S, ms) {
    const px = x + 12, py = y + 12, pw = w - 24, ph = h - 24;
    cv.roundRect(px, py, pw, ph, 10, INK);
    const lines = [
        { c: COLOURS[0], f: (t) => [px + pw * (0.12 + 0.76 * t), py + ph * (0.3 + 0.12 * Math.sin(t * 12))] },
        { c: COLOURS[4], f: (t) => [px + pw * (0.5 + 0.3 * Math.cos(t * 6.283)), py + ph * (0.62 + 0.22 * Math.sin(t * 6.283))] },
        { c: HUE, f: (t) => [px + pw * (0.15 + 0.3 * t), py + ph * (0.85 - 0.4 * t)] },
    ];
    const T = (ms % 6000) / 6000;
    lines.forEach((l, j) => {
        const k = Math.max(0, Math.min(1, T * 3 - j * 0.6));
        let prev = null;
        for (let i = 0; i <= 30 * k; i++) {
            const q = l.f(i / 30);
            if (prev) { cv.line(prev[0], prev[1], q[0], q[1], 9, S.a(l.c, 0.15)); cv.line(prev[0], prev[1], q[0], q[1], 4, l.c); }
            prev = q;
        }
        if (prev && k < 1 && k > 0) S.glowCircle(cv, prev[0], prev[1], 4, l.c, 0.8);
    });
    cv.strokeRoundRect(px, py, pw, ph, 10, 1, S.a(HUE, 0.4));
}

module.exports = {
    id: 'sketchpad',
    title: 'Sketchpad',
    blurb: 'Draw with a finger or the knob',
    order: 70,
    needs: [],
    score: { unit: '' },
    art,
    create(api) { return new Game(api); },
};
