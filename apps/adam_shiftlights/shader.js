'use strict';
/**
 * shader.js - the effect layers' fragment shaders (GLSL ES 1.00, idrive-apps PROTOCOL.md "Shaders") and
 * their uniforms. Each program stays within 16 uniform vectors (GLSL ES 1.00's minimum; the KOMBI's GPU is
 * unknown): test/shader_check.mjs counts them.
 *
 *   FS_SLATS     a slat bar (geom.slatBar): mirrored or '/' lean, centre gap or centre slat, glow, up to a
 *                10-letter palette, stage mode (stock blocks), the shift flash over the hull or the slats.
 *   FS_BRACKET   the HUD bracket's cream fill up to the rpm (1000-rpm cells, red while flashing); its shift-cell code
 *                is unused since 0.4.2 (u_cells count 0; config.js hudStyles.cells says why it stays); the rail,
 *                ticks and numerals are a static image (hudart.js).
 *
 * Sent only when they change: u_st (lit, flash, brightness, ...). While the flash is on, u_on 1 shows the flash and 0
 * shows nothing: the app sends it every half cycle (Flash mode App, the default since 0.4.3) or the renderer steps it
 * (Renderer: an `animate` started at the flash's start, output.js).
 */
const FS_SLATS = [
    'precision highp float;',
    'varying vec2 v_uv;',
    'uniform vec4 u_colors[10]; // the palette in lighting order, padded with its last colour: [9] is the flash colour',
    'uniform vec4 u_rect;       // rect w, h (px); the bar axis x and base y in the rect',
    'uniform vec4 u_geo;        // slat width, pitch, axis to the innermost slat at the base, slats a side',
    'uniform vec4 u_geo2;       // lean (px over the bar height), centre slat half width (0: a gap), bar height, glow (px)',
    'uniform vec4 u_mode;       // mirrored lean (1) or the same lean on both sides (0), outward fill, stage, the flash fills the hull',
    'uniform vec4 u_st;         // lit, flash, brightness, unlit alpha (> 0: unlit slats show once one is lit; < 0: always, at -w)',
    'uniform float u_on;',
    'vec4 pal(float i) {',
    '    vec4 c = u_colors[9];',
    '    for (int j = 0; j < 10; j++) { if (float(j) == i) c = u_colors[j]; }   // constant-index access only (ES 1.00)',
    '    return c;',
    '}',
    'float slatIndex(float k, float n) { return u_mode.y > 0.5 ? k : n - 1.0 - k; }',
    'bool slatLit(float i) { return u_mode.z > 0.5 ? u_st.x > 0.5 : i < u_st.x; }',
    'vec4 slatColor(float i) { return u_mode.z > 0.5 ? pal(u_st.x - 1.0) : pal(i); }',
    'void main() {',
    '    float slat = u_geo.x, pitch = u_geo.y, inner = u_geo.z, n = u_geo.w;',
    '    float lean = u_geo2.x, cHalf = u_geo2.y, barH = u_geo2.z, glow = u_geo2.w, bright = u_st.z;',
    '    float px = v_uv.x * u_rect.x, py = v_uv.y * u_rect.y;',
    '    float u = (u_rect.w - py) / barH;                       // 0 at the base, 1 at the top',
    '    float d = u_mode.x > 0.5 ? abs(px - u_rect.z) + lean * u : abs(px - lean * u - u_rect.z);   // from the axis, at the base',
    '    float uOut = max(0.0, max(-u, u - 1.0)) * barH;          // px above or below the bar',
    '    float dd = d - inner, hw = inner + (n - 1.0) * pitch + slat;',
    '    float k = floor(dd / pitch);',
    '    bool inBar = uOut == 0.0;',
    '    bool isCentre = inBar && cHalf > 0.0 && d < cHalf;',
    '    bool isSlat = inBar && dd >= 0.0 && k < n && mod(dd, pitch) < slat;',
    '    float idx = isCentre ? n : slatIndex(k, n);',
    '    bool flash = u_st.y > 0.5;',
    '    if (flash && u_on < 0.5) { gl_FragColor = vec4(0.0); return; }',
    '    vec4 flashC = vec4(u_colors[9].rgb * bright, 1.0);',
    '    if (flash) {',
    '        if ((u_mode.w > 0.5 && inBar && d <= hw) || isSlat || isCentre) { gl_FragColor = flashC; return; }',
    '    } else if (isSlat || isCentre) {',
    '        if (slatLit(idx)) { gl_FragColor = vec4(slatColor(idx).rgb * bright, 1.0); return; }',
    '        if ((u_st.x > 0.5 || u_st.w < 0.0) && u_st.w != 0.0) { gl_FragColor = vec4(pal(idx).rgb * bright, abs(u_st.w)); return; }',
    '        gl_FragColor = vec4(0.0); return;',
    '    }',
    '    if (glow <= 0.0) { gl_FragColor = vec4(0.0); return; }',
    '    // glow: the distance (in the sheared frame of the bar) to the nearest lit shape: the hull while flashing,',
    '    // else slats k-1..k+1 and the centre slat',
    '    float best = 1e6; vec3 col = vec3(0.0);',
    '    if (flash) {',
    '        float dx = u_mode.w > 0.5 ? max(0.0, d - hw) : 1e6;',
    '        best = length(vec2(dx, uOut)); col = flashC.rgb;',
    '        if (u_mode.w < 0.5) {',
    '            float k0 = clamp(floor(dd / pitch), 0.0, n - 1.0);',
    '            for (int m = -1; m <= 1; m++) {',
    '                float kk = clamp(k0 + float(m), 0.0, n - 1.0), lo = kk * pitch;',
    '                float ex = max(0.0, max(lo - dd, dd - lo - slat)), dist = length(vec2(ex, uOut));',
    '                if (dist < best) best = dist;',
    '            }',
    '        }',
    '    } else {',
    '        float k0 = clamp(floor(dd / pitch), 0.0, n - 1.0);',
    '        for (int m = -1; m <= 1; m++) {',
    '            float kk = clamp(k0 + float(m), 0.0, n - 1.0), i = slatIndex(kk, n), lo = kk * pitch;',
    '            float ex = max(0.0, max(lo - dd, dd - lo - slat)), dist = length(vec2(ex, uOut));',
    '            if (slatLit(i) && dist < best) { best = dist; col = slatColor(i).rgb * bright; }',
    '        }',
    '        if (cHalf > 0.0 && slatLit(n)) {',
    '            float dist = length(vec2(max(0.0, d - cHalf), uOut));',
    '            if (dist < best) { best = dist; col = slatColor(n).rgb * bright; }',
    '        }',
    '    }',
    '    float t = best / glow;',
    '    if (t >= 1.0) { gl_FragColor = vec4(0.0); return; }',
    '    gl_FragColor = vec4(col, 0.55 * (1.0 - t) * (1.0 - t));',
    '}',
].join('\n');

const FS_BRACKET = [
    'precision highp float;',
    'varying vec2 v_uv;',
    'uniform vec4 u_path[5];    // the bracket path, 10 points (rect px): tip, knee, end',
    'uniform vec4 u_rect;       // rect w, h (px); the fill from offset o0 to o1 below the rail line (px)',
    'uniform vec4 u_cell;       // path length (px), 1000-rpm cells on the scale, half the gap between cells (share of a cell)',
    'uniform vec4 u_st;         // fill end (px along the path), flash, brightness, lit cells',
    'uniform float u_on;',
    'uniform vec4 u_cream;',
    'uniform vec4 u_red;',
    'uniform vec4 u_cells;      // shift cells: start, end (px along the path), count (0: none), first-colour count',
    'uniform vec4 u_cells2;     // second-colour count, cell offsets o0, o1 (px), gap (share of a cell)',
    'uniform vec4 u_cy;',
    'uniform vec4 u_co;',
    'uniform vec4 u_cr;',
    'float bestD, bestS, bestOff, bestRaw, cum;',
    'void seg(vec2 p, vec2 a, vec2 b) {',
    '    vec2 v = b - a; float l = length(v);',
    '    if (l < 0.001) return;',
    '    vec2 t = v / l, nrm = vec2(-t.y, t.x);',
    '    float along = dot(p - a, t), c = clamp(along, 0.0, l);',
    '    float dist = length(p - (a + t * c));',
    '    if (dist < bestD) { bestD = dist; bestS = cum + c; bestRaw = cum + along; bestOff = dot(p - a, nrm); }',
    '    cum += l;',
    '}',
    'void main() {',
    '    vec2 p = vec2(v_uv.x * u_rect.x, v_uv.y * u_rect.y);',
    '    bestD = 1e6; bestS = 0.0; bestOff = 0.0; bestRaw = 0.0; cum = 0.0;',
    '    for (int j = 0; j < 4; j++) { seg(p, u_path[j].xy, u_path[j].zw); seg(p, u_path[j].zw, u_path[j + 1].xy); }',
    '    seg(p, u_path[4].xy, u_path[4].zw);',
    '    float L = u_cell.x, s = bestS, off = bestOff, bright = u_st.z;',
    '    if (bestRaw < 0.0 || bestRaw > L) { gl_FragColor = vec4(0.0); return; }   // past the tip or the end',
    '    bool flash = u_st.y > 0.5;',
    '    if (flash && u_on < 0.5) { gl_FragColor = vec4(0.0); return; }',
    '    if (!flash && u_cells.z > 0.5 && off >= u_cells2.y && off <= u_cells2.z) {',
    '        float w = (u_cells.y - u_cells.x) / u_cells.z, j = floor((s - u_cells.x) / w), f = s - u_cells.x - j * w, g = u_cells2.w * w;',
    '        if (j >= 0.0 && j < u_cells.z && j < u_st.w && f >= g * 0.5 && f <= w - g * 0.5) {',
    '            vec3 c = j < u_cells.w ? u_cy.rgb : j < u_cells.w + u_cells2.x ? u_co.rgb : u_cr.rgb;',
    '            gl_FragColor = vec4(c * bright, 1.0); return;',
    '        }',
    '    }',
    '    float r = s / L * u_cell.y, fr = fract(r);',
    '    bool gap = (r >= 1.0 && fr < u_cell.z) || fr > 1.0 - u_cell.z;',
    '    if (off >= u_rect.z && off <= u_rect.w && s <= u_st.x && s > 0.0 && !gap) {',
    '        gl_FragColor = vec4((flash ? u_red.rgb : u_cream.rgb) * bright, 1.0); return;',
    '    }',
    '    gl_FragColor = vec4(0.0);',
    '}',
].join('\n');

const rgb = (hex) => [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) / 255 * 10000) / 10000);
const r2 = (v) => Math.round(v * 100) / 100;

/** u_st.w for a slat style: its dim alpha, negative for an `idle` style (the unlit slats show at idle too). */
const unlitAlpha = (st) => (st.idle ? -st.dim : st.dim);

/** The static uniforms of a slats layer (geom.layersFor spec): [[name, values, opts]], for ClusterRender.uniform. */
function slatUniforms(spec, colors, level) {
    const g = spec.geom, st = g.style, d = g.dims, cols = [];
    for (let j = 0; j < 10; j++) Array.prototype.push.apply(cols, rgb(colors[st.palette[Math.min(j, st.palette.length - 1)]]).concat([1]));
    // the limiter flash fills the whole hull (slats and gap) for the slanted bars, only the fields for the
    // upright row and the stock blocks (the mockups)
    const hull = !st.stage && st.lean !== 'none' ? 1 : 0;
    return [
        ['u_colors', cols, { type: 'vec4' }],
        ['u_rect', [spec.rect.w, spec.rect.h, r2(g.local.cx), r2(g.local.yb)]],
        ['u_geo', [r2(d.slat), r2(d.pitch), r2(d.inner), d.perSide]],
        ['u_geo2', [r2(d.shear), r2(d.centre), r2(d.h), st.glow]],
        ['u_mode', [st.lean === 'same' ? 0 : 1, st.fill === 'outward' ? 1 : 0, st.stage ? 1 : 0, hull]],
        ['u_st', [0, 0, level, unlitAlpha(st)]],
        ['u_on', [1]],
    ];
}

/** Colour runs of a cells palette ('yyyyyoor' -> [['y', 5], ['o', 2], ['r', 1]]), at most 3 (validateConfig). */
function runsOf(p) {
    const out = [];
    p.split('').forEach((c) => { if (out.length && out[out.length - 1][0] === c) out[out.length - 1][1]++; else out.push([c, 1]); });
    return out;
}

/** The cells' place on the path for the thresholds: [start, end, count, first-colour count]. */
function cellUniform(spec, cellsCfg, th) {
    const b = spec.geom;
    if (!spec.cells || !th) return [0, 0, 0, 0];
    return [r2(b.sOf(th.start)), r2(b.sOf(th.shift)), cellsCfg.palette.length, runsOf(cellsCfg.palette)[0][1]];
}

/** The static uniforms of a bracketFill layer. */
function bracketUniforms(spec, colors, level, th, cellsCfg) {
    const b = spec.geom, R = spec.rect, path = [];
    b.pts.forEach((p) => { path.push(r2(p[0] - R.x), r2(p[1] - R.y)); });
    const rn = runsOf(cellsCfg.palette), col = (k) => rgb(colors[(rn[Math.min(k, rn.length - 1)] || rn[0])[0]]).concat([1]);
    return [
        ['u_path', path, { type: 'vec4' }],
        ['u_rect', [R.w, R.h, r2(b.o0), r2(b.o1)]],
        ['u_cell', [r2(b.L), b.B.scaleMax / 1000, Math.round(b.B.cellGap / 43 / 2 * 10000) / 10000, 0]],
        ['u_st', [0, 0, level, 0]],
        ['u_on', [1]],
        ['u_cream', rgb(colors.cream).concat([1])],
        ['u_red', rgb(colors.R).concat([1])],
        ['u_cells', cellUniform(spec, cellsCfg, th)],
        ['u_cells2', [rn.length > 1 ? rn[1][1] : 0, r2(b.cells[0]), r2(b.cells[1]), cellsCfg.gap]],
        ['u_cy', col(0)], ['u_co', col(1)], ['u_cr', col(2)],
    ];
}

module.exports = { FS_SLATS, FS_BRACKET, slatUniforms, bracketUniforms, cellUniform, rgb, unlitAlpha };
