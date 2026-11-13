'use strict';
/**
 * stages.js - what the cover and the KNOWN test step put on cluster-render's `panel` target, one layer a stage, in the
 * order output.js builds them (each confirmed by the renderer's status before the next). Pure: no I/O, Node 8.
 *
 *   coverStages(art, cfg)  [tachs, panels, centre, slats]: 4 layers, 10 assets (stage 4 only with the slats on)
 *       1 TACHS   the whole panel, opaque: background, tachs, fill, numerals   bgR2, overR, opal, band, atlas
 *       2 PANELS  both side panels and both corners (live boxes)               panelL, panelR, cornerL, cornerR, pal
 *       3 CENTRE  gear, speed, unit, the stack, line and caps                  (the atlas)
 *       4 SLATS   the shift-light slats above the gear                         none
 *   knownStages(card)      the KNOWN step: G's Dash's full-screen cluster test shape: one layer over the panel, one r8
 *                          1024 x 576 bilinear asset (card: its pixels)
 *   memoryOf(art)          the cover's share of the renderer's pixel memory: every asset, counted twice (cluster-render)
 *   encodeLH(px, w, rect, pal)  RGBA rows -> an r8 asset twice as wide: coverage left, palette index right (the live
 *                          boxes with PALETTE, the bars' over-art with OVER_PALETTE: tools/mtrack-art/make-art.mjs)
 * A stage: { id, name, what, rect, z, fs, assets: [{ name, format, w, h, sampling, px() }], binds: { sampler: asset },
 *   statics() -> uniforms after the bind, live(frame) -> uniforms on show and update, on(frame) -> used at all }
 * Uniforms: [[name, values, opts]].
 */
const zlib = require('zlib');
const S = require('./shader');
const G = require('./geom');

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
/** The live boxes' colours (widgets.js and the corners' art: 0.1.7 Codex's), nearest wins; index 0 is never written. */
const PALETTE = ['#000000', '#d7d9e1', '#acb0bd', '#707581', '#626875', '#b3283e', '#161a22', '#596171', '#c4c8d2', '#ff6a1a',
    '#c8c8e6', '#8282c8', '#f1141d', '#d0d3db', '#df8e2d', '#9aa0ad'].map(hex);
/** The tachs' over-art colours (art.html barOver, 0.1.7 Codex's: the bloom, the outer edge and its gradient, the inner
 * edge, the red edge and the ticks). */
const OVER_PALETTE = ['#000000', '#7e889e', '#151c27', '#2a303c', '#4a505e', '#6f7788', '#a0a8bb', '#b9bfd0', '#7f8798', '#424956',
    '#78283a', '#8a3748', '#9da3b2', '#555d6c', '#bc364e', '#d7d9e1'].map(hex);
const BOXES = ['panelL', 'panelR', 'cornerL', 'cornerR'];
const TINT = [0.97, 0.98, 1];

/** A 16-colour palette as a 16 x 1 rgba8 asset. */
function palPixels(pal) {
    const px = Buffer.alloc(16 * 4);
    pal.forEach((c, i) => { px[i * 4] = c[0]; px[i * 4 + 1] = c[1]; px[i * 4 + 2] = c[2]; px[i * 4 + 3] = 255; });
    return px;
}
function nearest(pal, r, g, b) {
    let best = 1, bd = Infinity;
    for (let k = 1; k < pal.length; k++) {
        const c = pal[k], d = (r - c[0]) * (r - c[0]) + (g - c[1]) * (g - c[1]) + (b - c[2]) * (b - c[2]);
        if (d < bd) { bd = d; best = k; }
    }
    return best;
}
/**
 * RGBA (straight alpha, w px a row) inside rect -> rect's rows of an r8 asset twice as wide: out = the coverage rows,
 * then the index rows (the two rects output.js sends: x and w + x). Coverage = alpha; index = the nearest colour x 17.
 */
function encodeLH(px, w, rect, pal) {
    const n = rect.w * rect.h, out = Buffer.alloc(2 * n);
    for (let y = 0; y < rect.h; y++) {
        for (let x = 0; x < rect.w; x++) {
            const i = ((rect.y + y) * w + rect.x + x) * 4, o = y * rect.w + x, a = px[i + 3];
            out[o] = a;
            out[n + o] = a ? nearest(pal, px[i], px[i + 1], px[i + 2]) * 17 : 0;
        }
    }
    return out;
}

const itemOf = (art, n) => (art.items || []).filter((x) => x.name === n)[0];
const decoded = new WeakMap();
/** An art item's pixels (inflated once per art object). */
function pixelsOf(art, n) {
    let m = decoded.get(art);
    if (!m) { m = {}; decoded.set(art, m); }
    if (!m[n]) {
        const it = itemOf(art, n);
        if (!it) throw new Error('art.json has no ' + n);
        const px = zlib.inflateRawSync(Buffer.from(it.data, 'base64'));
        if (px.length !== it.w * it.h * (it.format === 'r8' ? 1 : 4)) throw new Error('art.json ' + n + ': ' + px.length + ' bytes');
        m[n] = px;
    }
    return m[n];
}
const artAsset = (art, n) => { const it = itemOf(art, n) || { w: 0, h: 0, format: 'r8' }; return { name: n, format: it.format, w: it.w, h: it.h, sampling: it.sampling || 'nearest', px: () => pixelsOf(art, n) }; };
const boxAsset = (n) => { const r = G.RECTS[n]; return { name: n, format: 'r8', w: 2 * r.w, h: r.h, sampling: 'nearest', box: true, px: () => Buffer.alloc(2 * r.w * r.h) }; };

function coverStages(art, cfg) {
    const R = G.RECTS, A = art.atlas || { w: 1, h: 1, styles: { bar: { glyphs: {} } }, centre: { x: 0, y: 0, w: 0, h: 0, px: 0, py: 0 } };
    const B = cfg.build, slat = G.slatBar(cfg.row);
    const level = (f) => (typeof f.level === 'number' ? f.level : 1);
    return [
        {
            id: 'tachs', name: 'TACHS', what: 'the tachs: background, tachs, fill, numerals', rect: R.tachs, z: B.z,
            fs: S.tachsFs(art.atlas ? G.barNumeralQuads(A, cfg.tach) : [], A, R, G.point(cfg.tach.redFrom, cfg.tach)[1]),
            assets: [artAsset(art, 'bgR2'), artAsset(art, 'overR'), { name: 'opal', format: 'rgba8', w: 16, h: 1, sampling: 'nearest', px: () => palPixels(OVER_PALETTE) },
                artAsset(art, 'band'), artAsset(art, 'atlas')],
            binds: { u_bg: 'bgR2', u_over: 'overR', u_opal: 'opal', u_band: 'band', u_atlas: 'atlas' },
            statics: () => [],
            live: (f) => [['u_tint', TINT.concat([level(f)])], ['u_fill', [Math.round((typeof f.yr === 'number' ? f.yr : 720) * 10) / 10, G.TACH.pointerHalf, G.TACH.fillBottom, 0]]],
            on: () => true,
        },
        {
            id: 'panels', name: 'PANELS', what: 'the side panels and the corners', rect: R.panels, z: B.z + 1,
            fs: S.boxFs({ panelL: R.panelL, panelR: R.panelR, cornerL: R.cornerL, cornerR: R.cornerR }, R.panels),
            assets: BOXES.map(boxAsset).concat([{ name: 'pal', format: 'rgba8', w: 16, h: 1, sampling: 'nearest', px: () => palPixels(PALETTE) }]),
            binds: { u_pL: 'panelL', u_pR: 'panelR', u_cL: 'cornerL', u_cR: 'cornerR', u_pal: 'pal' },
            statics: () => [],
            live: (f) => [['u_bright', [level(f)]]],
            on: () => true,
        },
        {
            id: 'centre', name: 'CENTRE', what: 'gear, speed and the line', rect: R.centre, z: B.z + 2,
            fs: S.centreFs(R.centre, A),
            assets: [artAsset(art, 'atlas')],
            binds: { u_atlas: 'atlas' },
            statics: () => [],
            live: (f) => {
                const q = (f.quads || []).slice(0, S.QUADS), dst = [], src = [];
                for (let i = 0; i < S.QUADS; i++) { const x = q[i]; Array.prototype.push.apply(dst, x ? x.dst : [0, 0, 0, 0]); Array.prototype.push.apply(src, x ? x.src : [0, 0, 0, 0]); }
                return [['u_dst', dst, { type: 'vec4' }], ['u_src', src, { type: 'vec4' }], ['u_misc', [level(f), 0, 0, 0]]];
            },
            on: () => true,
        },
        {
            id: 'slats', name: 'SLATS', what: 'the shift-light slats', rect: slat.rect, z: B.z + 3, fs: S.FS_SLATS, assets: [], binds: {},
            statics: () => S.slatUniforms(slat, cfg.colors, 1).map((u) => [u[0], u[1], u[2]]),
            live: (f) => (f.slats ? [['u_st', [f.slats.lit, f.slats.flashing ? 1 : 0, level(f), S.unlitAlpha(cfg.row)]]] : []),
            on: (f) => !!(f && f.slats), slats: true,
        },
    ];
}

const KNOWN = { w: 1024, h: 576 };
/** The KNOWN step's test card: Canvas (kit/canvas) 1024 x 576, white on black, as r8 (its red channel). */
function knownCard(Canvas, version) {
    const W = KNOWN.w, H = KNOWN.h, cv = new Canvas(W, H).clear('#000000');
    for (let x = 64; x < W; x += 64) cv.fillRect(x, 0, 2, H, '#303030');
    for (let y = 64; y < H; y += 64) cv.fillRect(0, y, W, 2, '#303030');
    [[0, 0, W, 10], [0, H - 10, W, 10], [0, 0, 10, H], [W - 10, 0, 10, H]].forEach((r) => cv.fillRect(r[0], r[1], r[2], r[3], '#ffffff'));
    const t = (s, y, size) => cv.text(s, W / 2, y, size, '#ffffff', { align: 'center', font: 'bold', literal: true });
    t('KNOWN-GOOD TEST', 190, 92);
    t('M TRACK ' + (version || ''), 300, 60);
    t('THE DIALS AND THIS CARD ARE BOTH M TRACK', 410, 34);
    t('ONE LAYER COVERS THE WHOLE 1920 x 720 PANEL', 490, 34);
    const px = Buffer.alloc(W * H);
    for (let i = 0; i < W * H; i++) px[i] = cv.d[i * 4];
    return px;
}
/** The KNOWN step (G's Dash's full-screen test shape). card(): the 1024 x 576 r8 test card's pixels. */
function knownStages(card, cfg) {
    return [{
        id: 'known', name: 'KNOWN', what: 'one layer over the whole panel, one 1 MiB asset (G\'s Dash\'s test shape)',
        rect: G.RECTS.tachs, z: cfg.build.z, fs: S.knownFs(),
        assets: [{ name: 'card', format: 'r8', w: KNOWN.w, h: KNOWN.h, sampling: 'bilinear', px: card }],
        binds: { u_lab: 'card' }, statics: () => [],
        live: (f) => [['u_val', [typeof f.mph === 'number' ? Math.round(f.mph * 10) / 10 : -1, typeof f.rpm === 'number' ? Math.round(f.rpm / 10) / 100 : -1, 0, 0]]],
        on: () => true,
    }];
}

const bytesOf = (a) => a.w * a.h * (a.format === 'r8' ? 1 : 4);
/** The renderer memory the cover's assets take, as cluster-render counts it (each asset's pixels twice). */
function memoryOf(art) {
    const seen = {};
    let b = 0;
    coverStages(art, require('./config')).forEach((s) => s.assets.forEach((a) => { if (!seen[a.name]) { seen[a.name] = true; b += bytesOf(a) * 2; } }));
    return b;
}

const encodeBox = (px, w, rect) => encodeLH(px, w, rect, PALETTE);

module.exports = { coverStages, knownStages, knownCard, memoryOf, encodeLH, encodeBox, palPixels, PALETTE, OVER_PALETTE, BOXES, KNOWN, bytesOf, pixelsOf };
