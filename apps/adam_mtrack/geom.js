'use strict';
/**
 * geom.js - where the cover is drawn on the 1920 x 720 panel: pure geometry, Node 8, no I/O.
 * 0.1.7: the Codex-designed M display (ai-brain codex-mdash-test/out/m-display.html, HANDOFF.md), with Adam's two
 * corrections: the tach scale runs 0 to 7 (the spine's 9 anchors now span 0-7,000 rpm) and the fuel and oil gauges are
 * faceted solid bands, not round dials. Codex draws the left tach; the cover's art is the right one (x' = 1920 - x),
 * mirrored back for the left by the tachs layer. tools/mtrack-art/art.html loads this file, so the art and the live
 * fill agree.
 *
 *   point(rpm, T)       the right tach's spine point at rpm [x, y] (T: config tach)
 *   yOfRpm(rpm, T)      the height of the revs line (both tachs: mirrored, same y)
 *   ticks(T), numerals(T)   every tick / numeral place on the right tach, mirrored for the left
 *   gaugeQuads(f, side), gaugePoint(f, side, off)   the corner gauges' faceted band (side -1 fuel, 1 oil)
 *   gaugeLabelOff(f, side, w, h)                    a corner label's offset, 8 px clear of the band (art only)
 *   RECTS               every layer's rect; slotRect(side, half) the side panels' content boxes
 */
// Codex's spine, bottom to top: 9 anchors, now 0..7,000 rpm (left tach)
const SPINE = [[635, 590], [606, 525], [580, 459], [555, 394], [542, 328], [554, 262], [589, 201], [635, 143], [681, 87]];
// Codex's numeral offsets from the spine at s = 0, 2, 4, 6, 8: [label centre x - spine x, glyph top y - spine y]
const LABEL_OFF = [[57, -22], [63, -20], [73, -21], [70, -17], [34, -12]];
const TACH = { pointerHalf: 4.5, fillBottom: 605, labelW: 35, labelH: 26, tickX: 22, tickMajor: 24, tickMinor: 8 };

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const mirrorPt = (p) => [1920 - p[0], p[1]];
const mirror = (pts) => pts.map(mirrorPt);
const lerp = (a, b, t) => a + (b - a) * t;

/** Spine position s (0..8) at rpm: 0 at 0 rpm, 8 at T.max; clamped, NaN is 0. */
function spineS(rpm, T) {
    const r = typeof rpm === 'number' && isFinite(rpm) ? rpm : 0;
    return 8 * clamp(r, 0, T.max) / T.max;
}
function spineAt(s) {           // the left tach's point at spine position s
    const i = Math.min(7, Math.floor(s)), t = s - i;
    return [lerp(SPINE[i][0], SPINE[i + 1][0], t), lerp(SPINE[i][1], SPINE[i + 1][1], t)];
}
/** The right tach's spine point at rpm: [x, y]. */
const point = (rpm, T) => mirrorPt(spineAt(spineS(rpm, T)));
const yOfRpm = (rpm, T) => spineAt(spineS(rpm, T))[1];

/** Ticks every tickEvery rpm on the right tach: { rpm, x (where it starts), y, len (toward the centre), major }. */
function ticks(T) {
    const out = [];
    for (let r = 0; r <= T.max; r += T.tickEvery) {
        const p = point(r, T), major = r % 1000 === 0;
        out.push({ rpm: r, x: p[0] + TACH.tickX, y: p[1], len: major ? TACH.tickMajor : TACH.tickMinor, major });
    }
    return out;
}
/** Numerals 0..max/1000 on the right tach: { k, x, y } glyph centres (Codex's label offsets interpolated along s). */
function numerals(T) {
    const out = [], n = T.max / 1000;
    for (let k = 0; k <= n; k++) {
        const s = 8 * k / n, j = Math.min(3, Math.floor(s / 2)), t = s / 2 - j, p = spineAt(s);
        const dx = lerp(LABEL_OFF[j][0], LABEL_OFF[j + 1][0], t), dy = lerp(LABEL_OFF[j][1], LABEL_OFF[j + 1][1], t);
        out.push({ k, x: Math.round((1920 - (p[0] + dx)) * 10) / 10, y: Math.round((p[1] + dy + TACH.labelH / 2) * 10) / 10 });
    }
    return out;
}

/* ---------- the corner gauges: a faceted band (Adam's correction 2) ---------- */
// the left (fuel) gauge's centreline, low end to high end; the right (oil) one is its mirror
const GAUGE = { line: [[290, 592], [176, 592], [116, 532], [116, 440]], half: 9, gap: 3, lowCut: 18 };
const LEGS = GAUGE.line.slice(1).map((b, i) => {
    const a = GAUGE.line[i], dx = b[0] - a[0], dy = b[1] - a[1], len = Math.sqrt(dx * dx + dy * dy);
    return { a, len, d: [dx / len, dy / len], n: [-dy / len, dx / len] };      // n: toward the inner side (the panel's centre)
});
GAUGE.len = LEGS.reduce((s, l) => s + l.len, 0);
// each leg's edge start / end (distance along the leg) for the inner (+half) and outer (-half) edge: a mitre at each bend,
// pulled back gap/2 into each leg; the low end cut at 45 deg (outer edge longest), the high end flat
LEGS.forEach((L, i) => {
    const mitre = (M, o) => {        // where the edge at offset o meets the bisector at a bend, along this leg from its start
        const m = [M.n[0] + L.n[0], M.n[1] + L.n[1]], ml = Math.sqrt(m[0] * m[0] + m[1] * m[1]);
        const dot = (m[0] * L.n[0] + m[1] * L.n[1]) / ml;
        return o * (m[0] * L.d[0] + m[1] * L.d[1]) / ml / dot;
    };
    L.s = i === 0 ? { 1: GAUGE.lowCut, '-1': 0 } : { 1: mitre(LEGS[i - 1], GAUGE.half) + GAUGE.gap / 2, '-1': mitre(LEGS[i - 1], -GAUGE.half) + GAUGE.gap / 2 };
    L.e = i === LEGS.length - 1 ? { 1: L.len, '-1': L.len } : { 1: L.len + mitre(LEGS[i + 1], GAUGE.half) - GAUGE.gap / 2, '-1': L.len + mitre(LEGS[i + 1], -GAUGE.half) - GAUGE.gap / 2 };
});
const gx = (side, x) => (side > 0 ? 1920 - x : x);
const share = (f) => (typeof f === 'number' && isFinite(f) ? clamp(f, 0, 1) : 0);
/** The quads (4 points each, panel px) covering share f of the gauge from its low end; [] at 0, all three legs at 1. */
function gaugeQuads(f, side) {
    let rest = share(f) * GAUGE.len;
    const out = [];
    if (rest <= 0) return out;
    LEGS.forEach((L) => {
        if (rest <= 0) return;
        const c = rest;      // the partial leg ends in a cut perpendicular to it
        rest -= L.len;
        const at = (dist, o) => [L.a[0] + L.d[0] * dist + L.n[0] * o, L.a[1] + L.d[1] * dist + L.n[1] * o];
        const e = (k) => Math.min(L.e[k], Math.max(L.s[k], c));
        if (c <= Math.min(L.s[1], L.s['-1'])) return;
        const q = [at(L.s['-1'], -GAUGE.half), at(e('-1'), -GAUGE.half), at(e(1), GAUGE.half), at(L.s[1], GAUGE.half)];
        out.push(q.map((p) => [gx(side, p[0]), p[1]]));
    });
    return out;
}
/** The centreline point at share f, off px toward the inner side: [x, y]. */
function gaugePoint(f, side, off) {
    let d = share(f) * GAUGE.len, i = 0;
    while (i < LEGS.length - 1 && d > LEGS[i].len) { d -= LEGS[i].len; i++; }
    const L = LEGS[i], o = off || 0;
    return [gx(side, L.a[0] + L.d[0] * d + L.n[0] * o), L.a[1] + L.d[1] * d + L.n[1] * o];
}
/** Offset for a w x h label centred at gaugePoint(f, side, off): 26, or more so its box keeps 8 px clear of the band (Codex labelOff). */
function gaugeLabelOff(f, side, w, h) {
    const a = gaugePoint(f, side, 0), b = gaugePoint(f, side, 1);      // b - a: the unit normal of the leg at f
    return Math.max(26, GAUGE.half + 8 + (w * Math.abs(b[0] - a[0]) + h * Math.abs(b[1] - a[1])) / 2);
}

/* ---------- rects (panel px) ---------- */
// 0.1.7, Codex's layout: the side panels' slots (right; the left mirrored), the centre (gear over the line over the speed)
const SLOTS = { x0: 1464, x1: 1698, upper: [208, 338], lower: [342, 472] };
// gearY / speedY: the glyphs' middles (Codex tops 272 and 438); unitY: the unit's middle (Codex baseline 477)
const CENTRE = { cx: 960, gearTop: 272, gearW: 91, gearH: 112, gearY: 272 + 112 / 2, speedTop: 438, speedW: 49, speedH: 61, speedY: 438 + 61 / 2,
    unitX: 1087, unitY: 469, lineY: 406 };
const box = (x, y, w, h) => ({ target: 'panel', x, y, w, h });
const flipRect = (r) => box(1920 - r.x - r.w, r.y, r.w, r.h);
const RECTS = {
    tachs: box(0, 0, 1920, 720),               // the tachs layer: the whole panel, opaque (background, tachs, fill, numerals)
    band: box(1232, 82, 192, 520),             // the right tach's shape, Codex path A (mask), mirrored for the left
    overR: box(1228, 78, 194, 530),            // the right tach's edges, red edge, end line and ticks (mirrored for the left)
    centre: box(730, 266, 460, 240),           // the centre layer: gear (letter or digit), speed, unit, the stack, line and caps
    panelR: box(1450, 200, 260, 290),          // a side panel's content
    cornerL: box(96, 420, 400, 290),           // fuel gauge, range, clock
    cornerR: box(1530, 420, 320, 290),         // oil gauge, outside temperature
};
RECTS.overL = flipRect(RECTS.overR);
RECTS.panelL = flipRect(RECTS.panelR);
RECTS.panels = box(96, 200, 1754, 510);        // the panels layer: both side panels and both corners
/** The centre's static stack, line and end caps, one atlas cell drawn at this panel rect (tools/mtrack-art/art.html). */
const CENTRE_CELL = { x: 735, y: 340, w: 450, h: 72 };

/** A side panel's content box in panel px. half: 'upper' | 'lower' | 'full'; side -1 left, 1 right. */
function slotRect(side, half) {
    const x0 = side > 0 ? SLOTS.x0 : 1920 - SLOTS.x1, x1 = side > 0 ? SLOTS.x1 : 1920 - SLOTS.x0;
    const ys = half === 'full' ? [SLOTS.upper[0], SLOTS.lower[1]] : SLOTS[half];
    return { side, x0, x1, y0: ys[0], y1: ys[1], cx: (x0 + x1) / 2, cy: (ys[0] + ys[1]) / 2, w: x1 - x0, h: ys[1] - ys[0] };
}

/** Shift Lights' geom.slatBar, for one bar on the panel: its rect (grown by the glow) and the shader dims. */
function slatBar(st) {
    const n = st.perSide, half = st.inner + (n - 1) * st.pitch + st.slat;
    const yt = st.cy - st.h / 2, yb = st.cy + st.h / 2, g = st.glow || 0;
    const x = Math.floor(st.cx - half - g), y = Math.floor(yt - g);
    const rect = box(x, y, Math.ceil(st.cx + half + g) - x, Math.ceil(yb + g) - y);
    return { rect, style: st, local: { cx: st.cx - rect.x, yb: yb - rect.y },
        dims: { slat: st.slat, pitch: st.pitch, inner: st.inner, centre: st.centre || 0, h: st.h, shear: st.shear, perSide: n, half } };
}

/**
 * The centre block's glyph quads, in the glyph layer's rect: [{ dst: [x, y, w, h], src: [x, y, intensity, 0] }], at
 * most 5. atlas: art.json's atlas table. f: { gear (logic.gearGlyph: 'P' 'R' 'N' 'D' '-' or the engaged gear's digit
 * '1'-'8', drawn in the one big gear spot; anything else a dash), speed (whole number shown, or null: a dash), unit
 * ('mph' | 'km/h') }. 0.1.7: no drive-mode tag (neither Codex's design nor BMW's photo has one).
 */
function centreQuads(atlas, f) {
    const R = RECTS.centre, X = CENTRE.cx, out = [];
    const put = (cell, x, y, k) => { if (cell) out.push({ dst: [Math.round(x - R.x), Math.round(y - R.y), cell.w, cell.h], src: [cell.x, cell.y, k, 0] }); };
    const gs = atlas.styles.gear, sp = atlas.styles.speed;
    const g = typeof f.gear === 'string' && gs.glyphs[f.gear] ? f.gear : '-';
    const gc = gs.glyphs[g];
    put(gc, X - gc.adv / 2 - gc.ox, CENTRE.gearY - gc.h / 2, 1);
    const s = typeof f.speed === 'number' && isFinite(f.speed) ? String(Math.max(0, Math.min(999, Math.round(f.speed)))) : '-';
    const cells = s.split('').map((ch) => sp.glyphs[ch]);
    let x = X - (cells.reduce((a, c) => a + c.adv + sp.gap, -sp.gap)) / 2;
    cells.forEach((c) => { put(c, x - c.ox, CENTRE.speedY - c.h / 2, 1); x += c.adv + sp.gap; });
    const u = atlas.labels[f.unit] || atlas.labels.mph;
    put(u, CENTRE.unitX - u.ox, CENTRE.unitY - u.h / 2, 0.52);   // 0.1.7: Codex's muted #707581 over the glyph colour
    return out;
}

/**
 * The tachs' numerals 0..7 on both tachs, from the atlas's bar style: [{ dst: [x, y, w, h] (panel px, whole), src: [x, y]
 * (atlas px) }], the right bar's 8 then the left's (placed at the mirror of each centre, the glyph itself not mirrored).
 */
function barNumeralQuads(atlas, T) {
    const st = atlas.styles.bar, out = [];
    [1, -1].forEach((side) => numerals(T).forEach((n) => {
        const c = st.glyphs[String(n.k)], cx = side > 0 ? n.x : 1920 - n.x;
        out.push({ dst: [Math.round(cx - c.adv / 2 - c.ox), Math.round(n.y - c.h / 2), c.w, c.h], src: [c.x, c.y] });
    }));
    return out;
}

module.exports = {
    centreQuads, barNumeralQuads, CENTRE_CELL,
    SPINE, TACH, GAUGE, CENTRE, SLOTS, RECTS, mirror, mirrorPt, point, yOfRpm, ticks, numerals, gaugeQuads, gaugePoint, gaugeLabelOff,
    slotRect, slatBar, flipRect,
};
