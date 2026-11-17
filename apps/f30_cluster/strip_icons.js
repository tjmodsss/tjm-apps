'use strict';
/**
 * Strip pictograms (package P, 2026-11-16): the severity markers for our own check-control line (variant A) and the
 * common message symbols. OUR OWN DRAWINGS, made here from primitives after the shapes ISO 2575 / UN R121 Table 1
 * standardise (a triangle with "!", an "i", a brake circle with "( ! )", a tyre profile with "!", an engine block,
 * a windscreen with a washer jet, a seated person with a diagonal belt, a car seen from above with a door open).
 * Nothing here was traced, sampled or measured off BMW's artwork, a photo of it or the car's snapshot; no file of
 * anyone else's is read. Licence: the repository's MIT licence. See PROVENANCE.md beside this file.
 *
 * One source, three outputs:
 *   - ICONS: distance functions with the same contract as shared/icons.js (x, y in a 0..1 box, y down; the result is
 *     the distance to the ink in box units, < 0 inside), so shared/icons.js paintIcon() draws them unchanged.
 *     To ship: copy this file to shared/strip_icons.js and add one line to shared/icons.js:
 *         Object.assign(ICONS, require('./strip_icons').ICONS);
 *     after which a layout's icon widget takes "icon": "cc_warn" etc.
 *   - svg(name): the same shapes as an SVG (a mask applies the cuts in the same order), for review and for anyone who
 *     wants a vector.
 *   - tools/strip/P/bake_pictograms.js bakes alpha PNGs with paintIcon's own anti-aliasing (identical to the runtime).
 *
 * The DSL: each icon is a list of steps, applied in order; a step either adds ink (d = min(d, p)) or cuts it
 * (d = max(d, -p)) when it carries cut: true.
 *   seg  [ax, ay, bx, by, w]           a stroke with round caps, width w
 *   ring [cx, cy, r, w]                a circle stroke
 *   arc  [cx, cy, r, a0, a1, w]        a round-capped arc, angles in degrees clockwise from 12 o'clock, a0 < a1
 *   disc [cx, cy, r]                   a filled circle
 *   box  [cx, cy, hw, hh, r]           a filled rounded rectangle (half sizes, corner radius r)
 *   boxo [cx, cy, hw, hh, r, w]        the outline of that rectangle, stroke width w centred on its edge
 *   poly [[x, y], ...], r              a filled convex polygon grown by r (round corners)
 */

const RAD = Math.PI / 180;

function dSeg(px, py, ax, ay, bx, by) {
    const pax = px - ax, pay = py - ay, bax = bx - ax, bay = by - ay;
    const h = Math.max(0, Math.min(1, (pax * bax + pay * bay) / (bax * bax + bay * bay || 1)));
    return Math.hypot(pax - bax * h, pay - bay * h);
}
function dArc(px, py, cx, cy, r, a0, a1) {          // angles in radians clockwise from 12 o'clock, a0 < a1
    let a = Math.atan2(px - cx, -(py - cy)); if (a < a0) a += Math.PI * 2;
    if (a <= a1) return Math.abs(Math.hypot(px - cx, py - cy) - r);
    const e = (b) => Math.hypot(px - (cx + r * Math.sin(b)), py - (cy - r * Math.cos(b)));
    return Math.min(e(a0), e(a1));
}
function dBox(px, py, cx, cy, hw, hh, r) {
    const qx = Math.abs(px - cx) - (hw - r), qy = Math.abs(py - cy) - (hh - r);
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}
function dPoly(px, py, pts) {                         // signed distance to a polygon (any winding), < 0 inside
    let d = Infinity, inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i], [xj, yj] = pts[j];
        d = Math.min(d, dSeg(px, py, xj, yj, xi, yi));
        if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside ? -d : d;
}

function stepDist(s, x, y) {
    const a = s.a;
    switch (s.k) {
        case 'seg': return dSeg(x, y, a[0], a[1], a[2], a[3]) - a[4] / 2;
        case 'ring': return Math.abs(Math.hypot(x - a[0], y - a[1]) - a[2]) - a[3] / 2;
        case 'arc': return dArc(x, y, a[0], a[1], a[2], a[3] * RAD, a[4] * RAD) - a[5] / 2;
        case 'disc': return Math.hypot(x - a[0], y - a[1]) - a[2];
        case 'box': return dBox(x, y, a[0], a[1], a[2], a[3], a[4]);
        case 'boxo': return Math.abs(dBox(x, y, a[0], a[1], a[2], a[3], a[4])) - a[5] / 2;
        case 'poly': return dPoly(x, y, a) - (s.r || 0);
        default: throw new Error('unknown step ' + s.k);
    }
}

// ---- the drawings --------------------------------------------------------------------------------------------------
const S = (k, a, o) => Object.assign({ k, a }, o || {});
const cut = { cut: true };

// The warning triangle: equilateral, point up, 0.90 wide, its centroid a little below the box centre so the
// shape sits optically centred. Stroke 0.08 of the box (2.4 px at 30 px, the stock marker slot).
const TRI = [[0.5, 0.075], [0.95, 0.854], [0.05, 0.854]];
const triEdges = (w) => TRI.map((p, i) => { const q = TRI[(i + 1) % 3]; return S('seg', [p[0], p[1], q[0], q[1], w]); });

const DRAWINGS = {
    // -- severity markers (variant A) --
    // general warning: outline triangle with "!" (ISO 2575 / ISO 7000 "general warning" shape)
    cc_warn: [
        ...triEdges(0.08),
        S('seg', [0.5, 0.37, 0.5, 0.6, 0.085]),
        S('disc', [0.5, 0.715, 0.052]),
    ],
    // the same, filled, with the "!" knocked out: for a red/yellow severity where an outline reads too thin
    cc_warn_solid: [
        S('poly', TRI, { r: 0.035 }),
        S('seg', [0.5, 0.37, 0.5, 0.6, 0.09], cut),
        S('disc', [0.5, 0.715, 0.056], cut),
    ],
    // information: a lower-case "i" (dot, stem, a short left serif at the top and a foot)
    cc_info: [
        S('disc', [0.5, 0.15, 0.085]),
        S('seg', [0.5, 0.37, 0.5, 0.86, 0.13]),
        S('seg', [0.38, 0.37, 0.5, 0.37, 0.1]),
        S('seg', [0.36, 0.875, 0.64, 0.875, 0.1]),
    ],
    // neutral: no severity, only "a message is up" - a plain dot, the size of the "i"'s stem weight
    cc_dot: [
        S('disc', [0.5, 0.5, 0.15]),
    ],

    // -- message symbols --
    // door open: the car from above (a rounded body, the windscreen and the rear window as bars) with its front left
    // door swung out from the A-pillar hinge
    cc_door: [
        S('boxo', [0.6, 0.5, 0.22, 0.42, 0.14, 0.07]),
        S('seg', [0.46, 0.31, 0.74, 0.31, 0.07]),               // windscreen
        S('seg', [0.48, 0.75, 0.72, 0.75, 0.07]),               // rear window
        S('seg', [0.38, 0.43, 0.38, 0.62, 0.13], cut),          // the gap the door leaves in the body side
        S('seg', [0.38, 0.4, 0.13, 0.6, 0.075]),                // the open door, hinged at its front edge
    ],
    // brake system: a circle, a parenthesis either side, "!" inside (UN R121 Table 1 item 25's shape)
    cc_brake: [
        S('ring', [0.5, 0.5, 0.25, 0.075]),
        S('arc', [0.5, 0.5, 0.41, 45, 135, 0.075]),
        S('arc', [0.5, 0.5, 0.41, 225, 315, 0.075]),
        S('seg', [0.5, 0.37, 0.5, 0.54, 0.075]),
        S('disc', [0.5, 0.63, 0.045]),
    ],
    // tyre pressure: a tyre's cross-section open at the top, tread marks under it, "!" inside (R121 item 42a's shape)
    cc_tyre: [
        S('arc', [0.5, 0.47, 0.33, 40, 320, 0.075]),
        S('seg', [0.31, 0.86, 0.31, 0.93, 0.06]),
        S('seg', [0.44, 0.88, 0.44, 0.95, 0.06]),
        S('seg', [0.56, 0.88, 0.56, 0.95, 0.06]),
        S('seg', [0.69, 0.86, 0.69, 0.93, 0.06]),
        S('seg', [0.5, 0.33, 0.5, 0.52, 0.075]),
        S('disc', [0.5, 0.62, 0.045]),
    ],
    // engine: the side view of an engine block with its filler on top, a stub left and the fan housing right
    // (R121 item 30's shape, "engine malfunction")
    cc_engine: [
        S('boxo', [0.5, 0.58, 0.24, 0.16, 0.03, 0.07]),
        S('seg', [0.38, 0.28, 0.6, 0.28, 0.07]),
        S('seg', [0.49, 0.28, 0.49, 0.42, 0.07]),
        S('seg', [0.1, 0.48, 0.1, 0.7, 0.07]),
        S('seg', [0.1, 0.59, 0.26, 0.59, 0.07]),
        S('seg', [0.74, 0.53, 0.9, 0.45, 0.07]),
        S('seg', [0.9, 0.45, 0.9, 0.76, 0.07]),
        S('seg', [0.9, 0.76, 0.74, 0.68, 0.07]),
    ],
    // washer fluid: a windscreen (arched top, slanted sides, flat base) with a jet rising from a nozzle in a dotted
    // fountain (the shape of R121's windscreen washer symbol)
    cc_washer: [
        S('arc', [0.5, 1.12, 0.8, -32, 32, 0.07]),
        S('seg', [0.076, 0.442, 0.2, 0.86, 0.07]),
        S('seg', [0.924, 0.442, 0.8, 0.86, 0.07]),
        S('seg', [0.2, 0.86, 0.8, 0.86, 0.07]),
        S('seg', [0.5, 0.86, 0.5, 0.78, 0.08]),                 // the nozzle
        // the jet: two dashed arcs rising from the nozzle and falling away either side
        S('arc', [0.3, 0.8, 0.2, 58, 80, 0.06]), S('arc', [0.3, 0.8, 0.2, 14, 38, 0.06]),
        S('arc', [0.3, 0.8, 0.2, -32, -8, 0.06]),
        S('arc', [0.7, 0.8, 0.2, 280, 302, 0.06]), S('arc', [0.7, 0.8, 0.2, 322, 346, 0.06]),
        S('arc', [0.7, 0.8, 0.2, 8, 32, 0.06]),
    ],
    // seat belt: a seated person seen from the side, the belt a diagonal band across the torso cut out with a margin
    // (R121 Table 1 item 21's shape)
    cc_belt: [
        S('disc', [0.43, 0.15, 0.095]),
        S('seg', [0.41, 0.33, 0.45, 0.63, 0.17]),
        S('seg', [0.45, 0.68, 0.71, 0.68, 0.14]),
        S('seg', [0.71, 0.68, 0.73, 0.92, 0.12]),
        S('seg', [0.22, 0.28, 0.26, 0.78, 0.06]),               // the seat back
        S('seg', [0.6, 0.29, 0.3, 0.62, 0.11], cut),            // the belt's margin
        S('seg', [0.58, 0.31, 0.32, 0.6, 0.05]),                // the belt
    ],
};

// ---- outputs --------------------------------------------------------------------------------------------------------
function sdf(steps) {
    return (x, y) => {
        let d = Infinity;
        for (const s of steps) {
            const p = stepDist(s, x, y);
            d = s.cut ? Math.max(d, -p) : Math.min(d, p);
        }
        return d;
    };
}
const ICONS = {};
for (const n of Object.keys(DRAWINGS)) ICONS[n] = sdf(DRAWINGS[n]);

const f = (v) => +(v * 100).toFixed(2);
function stepSvg(s, fill) {
    const a = s.a;
    const st = (w) => `fill="none" stroke="${fill}" stroke-width="${f(w)}" stroke-linecap="round" stroke-linejoin="round"`;
    switch (s.k) {
        case 'seg': return `<line x1="${f(a[0])}" y1="${f(a[1])}" x2="${f(a[2])}" y2="${f(a[3])}" ${st(a[4])}/>`;
        case 'ring': return `<circle cx="${f(a[0])}" cy="${f(a[1])}" r="${f(a[2])}" ${st(a[3])}/>`;
        case 'arc': {
            const P = (deg) => [a[0] + a[2] * Math.sin(deg * RAD), a[1] - a[2] * Math.cos(deg * RAD)];
            const [x0, y0] = P(a[3]), [x1, y1] = P(a[4]);
            const large = a[4] - a[3] > 180 ? 1 : 0;
            return `<path d="M${f(x0)} ${f(y0)}A${f(a[2])} ${f(a[2])} 0 ${large} 1 ${f(x1)} ${f(y1)}" ${st(a[5])}/>`;
        }
        case 'disc': return `<circle cx="${f(a[0])}" cy="${f(a[1])}" r="${f(a[2])}" fill="${fill}"/>`;
        case 'box': return `<rect x="${f(a[0] - a[2])}" y="${f(a[1] - a[3])}" width="${f(2 * a[2])}" height="${f(2 * a[3])}" rx="${f(a[4])}" fill="${fill}"/>`;
        case 'boxo': return `<rect x="${f(a[0] - a[2])}" y="${f(a[1] - a[3])}" width="${f(2 * a[2])}" height="${f(2 * a[3])}" rx="${f(a[4])}" ${st(a[5])}/>`;
        case 'poly': {
            const pts = a.map((p) => f(p[0]) + ',' + f(p[1])).join(' ');
            const r = s.r || 0;
            return `<polygon points="${pts}" fill="${fill}"` + (r ? ` stroke="${fill}" stroke-width="${f(2 * r)}" stroke-linejoin="round"` : '') + '/>';
        }
        default: throw new Error('unknown step ' + s.k);
    }
}
/** An SVG of one pictogram, 100 x 100 user units (1 box unit = 100), in currentColor. */
function svg(name, note) {
    const steps = DRAWINGS[name];
    const body = steps.map((s) => '    ' + stepSvg(s, s.cut ? 'black' : 'white')).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>
<!-- ${name}: ${note || ''}
     Our own drawing (package P, f30-cluster, 2026-11-16), generated by tools/strip/P/bake_pictograms.js from
     design/strip/pictograms/pictograms.js. Not traced from BMW artwork. Licence: MIT (the repository's LICENSE). -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
  <title>${name}</title>
  <mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
    <rect width="100" height="100" fill="black"/>
${body}
  </mask>
  <rect width="100" height="100" fill="currentColor" mask="url(#m)"/>
</svg>
`;
}

module.exports = { ICONS, DRAWINGS, svg };
