'use strict';
/**
 * The HUD's GLSL ES 1.00 fragment shaders for cluster-render "effect" layers, drawn on the
 * car's GPU. Kept as JS strings because the kit's build ships an app's top-level .js files
 * as they are (a data folder becomes a JSON-only pack). hud.js sends the uniforms.
 */
const SHIFTBAR = `// Segmented shift bar for a cluster-render "effect" layer (GLSL ES 1.00).
// v_uv is 0..1 across the layer, (0,0) at the top-left as on the car. Uniforms come from hud.js:
//   u_value   0..1, how much of the bar is lit (rpm / bar max)
//   u_size    layer size in px (w, h), for round corners and gaps in pixels
//   u_segs    segment count
//   u_low, u_mid, u_high   zone colours (rgb 0..1)
//   u_midAt, u_highAt      where the mid and high zones start (0..1 of the bar)
//   u_track   unlit segment colour (rgba, straight alpha)
//   u_flash   1 = at the redline: every lit segment shows the high colour
// Output is straight alpha. Whether cluster-render blends effect layers as
// straight or premultiplied alpha is not confirmed yet: check the edges on the car.
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;     // px-scale maths: mediump is fp16 on the car's GPU (x*x+y*y overflows past ~256 px)
#else
precision mediump float;
#endif
varying vec2 v_uv;
uniform float u_value;
uniform vec2 u_size;
uniform float u_segs;
uniform vec3 u_low;
uniform vec3 u_mid;
uniform vec3 u_high;
uniform float u_midAt;
uniform float u_highAt;
uniform vec4 u_track;
uniform float u_flash;

void main() {
    float gapPx = 3.0;
    float slot = u_size.x / u_segs;                 // px per segment incl. gap
    float px = v_uv.x * u_size.x;
    float idx = floor(px / slot);
    float inSeg = px - idx * slot;                  // px into this slot
    float segW = slot - gapPx;
    float py = v_uv.y * u_size.y;           // px from the top

    // rounded-rect coverage for this segment, radius 2px, 1px soft edge
    vec2 hs = vec2(segW, u_size.y) * 0.5;
    vec2 p = vec2(inSeg, py) - hs;
    vec2 q = abs(p) - (hs - vec2(2.0));
    float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 2.0;
    float cover = clamp(0.5 - d, 0.0, 1.0);
    if (inSeg > segW) cover = 0.0;
    if (cover <= 0.0) { gl_FragColor = vec4(0.0); return; }

    float pos = (idx + 0.5) / u_segs;               // segment centre, 0..1
    bool lit = pos <= u_value;
    vec3 c = pos >= u_highAt ? u_high : (pos >= u_midAt ? u_mid : u_low);
    if (u_flash > 0.5) c = u_high;
    gl_FragColor = lit ? vec4(c, cover) : vec4(u_track.rgb, u_track.a * cover);
}
`;

const ARC = `// Thin open arc gauge for a cluster-render "effect" layer (GLSL ES 1.00).
// u_start / u_sweep (radians, clockwise from 12 o'clock; a negative sweep runs anticlockwise), round
// ends, filled from the start. hud.js default: 270 degrees from the lower left, the gap at the bottom.
// Uniforms from hud.js:
//   u_value  0..1 of the sweep
//   u_size   layer size in px (w, h)
//   u_color  lit arc (rgb 0..1)
//   u_track  unlit arc (rgba, straight alpha)
//   u_width  stroke width in px
// Output is straight alpha (same open question as the shift bar shader above).
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;     // px-scale maths: mediump is fp16 on the car's GPU (x*x+y*y overflows past ~256 px)
#else
precision mediump float;
#endif
varying vec2 v_uv;
uniform float u_value;
uniform vec2 u_size;
uniform vec3 u_color;
uniform vec4 u_track;
uniform float u_width;
uniform float u_start;
uniform float u_sweep;
uniform float u_peak;    // peak hold 0..1 of the sweep, a bright dot on the stroke (below 0: none)
uniform vec3 u_peakC;

const float PI = 3.14159265359;

// distance from point p (centred, px) to the arc from angle a0 sweeping s, radius r
float arcDist(vec2 p, float r, float a0, float s) {
    float a = atan(p.x, p.y);           // clockwise from 12 o'clock, -PI..PI
    float rel = mod(a - a0 + 4.0 * PI, 2.0 * PI);
    if (rel <= s) return abs(length(p) - r);
    vec2 e0 = r * vec2(sin(a0), cos(a0));
    vec2 e1 = r * vec2(sin(a0 + s), cos(a0 + s));
    return min(length(p - e0), length(p - e1));   // round end caps
}

void main() {
    vec2 p = vec2(v_uv.x - 0.5, 0.5 - v_uv.y) * u_size;   // px from centre, +y up (v_uv is top-left)
    float start = u_start, sweep = u_sweep;
    if (sweep < 0.0) { p.x = -p.x; start = -start; sweep = -sweep; }   // anticlockwise = mirrored clockwise
    float r = min(u_size.x, u_size.y) * 0.5 - u_width * 0.5 - 1.0;
    float hw = u_width * 0.5;
    float dTrack = arcDist(p, r, start, sweep) - hw;
    float lit = clamp(u_value, 0.0, 1.0) * sweep;
    float dLit = lit > 0.001 ? arcDist(p, r, start, lit) - hw : 1e5;
    float cLit = clamp(0.5 - dLit, 0.0, 1.0);
    float cTrack = clamp(0.5 - dTrack, 0.0, 1.0);
    if (u_peak >= 0.0) {
        float pa = start + clamp(u_peak, 0.0, 1.0) * sweep;
        float dp = length(p - r * vec2(sin(pa), cos(pa))) - hw * 1.35;
        float cp = clamp(0.5 - dp, 0.0, 1.0);
        if (cp > 0.0) { gl_FragColor = vec4(u_peakC, cp); return; }
    }
    if (cLit > 0.0) gl_FragColor = vec4(u_color, cLit);
    else gl_FragColor = vec4(u_track.rgb, u_track.a * cTrack);
}
`;

const REVBAR = `// G20 Live Cockpit style rev bar for a cluster-render "effect" layer (GLSL ES 1.00), after
// cauliflowermossgrape's Redline app (MIT). From the top of the layer: u_top px for the shift-point and
// redline marks, then the bar (u_barH px, slanted: its top edge is u_slant px right of its bottom
// edge), then the scale ticks. The bar fills left to right in 500 rpm segments; each lit segment
// takes the ramp colour of its position up to the shift point (u_from -> u_to), all u_hot from the
// shift point on. Unlit: u_track, and u_hot faint past the redline. A white needle leads the fill;
// a thin slanted line holds the peak. Uniforms (rpm values are rpm, not 0..1):
//   u_size, u_top, u_barH, u_slant   px
//   u_max, u_value, u_shift, u_red, u_peak   rpm
//   u_from, u_to, u_hot   rgb 0..1;  u_track, u_tick, u_fg   rgba (straight alpha)
//   u_shiftNow   1 = at or past the shift point
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;     // px-scale maths: mediump is fp16 on the car's GPU (x*x+y*y overflows past ~256 px)
#else
precision mediump float;
#endif
varying vec2 v_uv;
uniform vec2 u_size;
uniform float u_top;
uniform float u_barH;
uniform float u_slant;
uniform float u_max;
uniform float u_value;
uniform float u_shift;
uniform float u_red;
uniform float u_peak;
uniform vec3 u_from;
uniform vec3 u_to;
uniform vec3 u_hot;
uniform vec4 u_track;
uniform vec4 u_tick;
uniform vec4 u_fg;
uniform float u_shiftNow;

vec4 over(vec4 top, vec4 under) {           // straight-alpha "top over under"
    float a = top.a + under.a * (1.0 - top.a);
    if (a <= 0.0) return vec4(0.0);
    return vec4((top.rgb * top.a + under.rgb * under.a * (1.0 - top.a)) / a, a);
}

void main() {
    float px = v_uv.x * u_size.x;
    float py = v_uv.y * u_size.y;   // px from the top
    float bw = u_size.x - u_slant;            // bar length along the bottom edge
    float perRpm = bw / u_max;
    vec4 c = vec4(0.0);

    // marks above the bar: shift point (amber) and redline (red), at the bar's top edge
    if (py < u_top - 2.0) {
        float ds = abs(px - (u_shift * perRpm + u_slant));
        float dr = abs(px - (u_red * perRpm + u_slant));
        if (ds < 2.0) c = vec4(1.0, 0.76, 0.1, clamp(2.0 - ds, 0.0, 1.0));
        if (dr < 2.0) c = vec4(u_hot, clamp(2.0 - dr, 0.0, 1.0));
        gl_FragColor = c; return;
    }

    float by = py - u_top;                    // px down from the bar's top edge
    if (by <= u_barH) {
        float off = u_slant * (u_barH - by) / u_barH;
        float s = px - off;                   // px along the bar at this height
        float rpm = s / perRpm;
        float inside = clamp(s + 0.5, 0.0, 1.0) * clamp(bw - s + 0.5, 0.0, 1.0)
            * clamp(by + 0.5, 0.0, 1.0) * clamp(u_barH - by + 0.5, 0.0, 1.0);
        // slanted 3 px gap every 500 rpm
        float seg = floor(rpm / 500.0);
        float dGap = abs(s - floor(rpm / 500.0 + 0.5) * 500.0 * perRpm);
        float gap = rpm > 250.0 && rpm < u_max - 250.0 ? clamp(dGap - 1.0, 0.0, 1.0) : 1.0;
        vec4 bar;
        if (rpm <= u_value) {
            float f = clamp((seg * 500.0 + 250.0) / u_shift, 0.0, 1.0);
            vec3 col = u_shiftNow > 0.5 ? u_hot : mix(u_from, u_to, f);
            bar = vec4(col, 1.0);
        } else if (rpm >= u_red) bar = vec4(u_hot, 0.3);
        else bar = u_track;
        c = vec4(bar.rgb, bar.a * inside * gap);
        // peak: a thin slanted line where the rpm last peaked (only above the current rpm)
        if (u_peak > u_value + 60.0) {
            float dp = abs(s - u_peak * perRpm);
            vec3 pc = u_peak >= u_shift ? u_hot : mix(u_from, u_to, clamp(u_peak / u_shift, 0.0, 1.0));
            c = over(vec4(pc, clamp(1.5 - dp, 0.0, 1.0) * inside), c);
        }
        // needle: the bright leading edge of the fill
        if (u_value > 50.0) {
            float dn = abs(s - min(u_value, u_max) * perRpm);
            c = over(vec4(1.0, 1.0, 1.0, clamp(2.5 - dn, 0.0, 1.0) * clamp(by + 2.5, 0.0, 1.0) * clamp(u_barH - by + 2.5, 0.0, 1.0)), c);
        }
        gl_FragColor = c; return;
    }

    // scale ticks under the bar: every 500 rpm, longer every 1000, red from the redline
    float ty = by - u_barH - 4.0;
    if (ty >= 0.0) {
        float rpm = px / perRpm;
        float k = floor(rpm / 500.0 + 0.5);
        float d = abs(px - k * 500.0 * perRpm);
        bool major = mod(k, 2.0) < 0.5;
        float len = major ? 10.0 : 5.0;
        float hw = major ? 1.25 : 0.75;
        float a = clamp(hw + 0.5 - d, 0.0, 1.0) * (ty <= len ? 1.0 : 0.0);
        vec4 tc = k * 500.0 >= u_red ? vec4(u_hot, 1.0) : (major ? u_fg : u_tick);
        c = vec4(tc.rgb, tc.a * a);
    }
    gl_FragColor = c;
}
`;

const LIGHTS = `// Shift lights for a cluster-render "effect" layer (GLSL ES 1.00), after cauliflowermossgrape's Redline
// app (MIT): u_n rounded lights in a row, green -> yellow -> red from left to right. u_lit of them are
// on (they fill from a start rpm up to the shift point); u_strobe 1 = at the shift point: all red.
// The last u_tail lights are blue instead (the GT3 dash look; 0 = none). u_round 1 = round lights.
//   u_size px, u_n count, u_lit count (0..u_n), u_tail count, u_strobe 0/1, u_green/u_yellow/u_red/u_blue rgb,
//   u_off (alpha when off)
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;     // px-scale maths: mediump is fp16 on the car's GPU (x*x+y*y overflows past ~256 px)
#else
precision mediump float;
#endif
varying vec2 v_uv;
uniform vec2 u_size;
uniform float u_n;
uniform float u_lit;
uniform float u_tail;
uniform float u_round;
uniform float u_strobe;
uniform vec3 u_green;
uniform vec3 u_yellow;
uniform vec3 u_red;
uniform vec3 u_blue;
uniform float u_off;

void main() {
    float gapPx = 6.0;
    float slot = (u_size.x + gapPx) / u_n;
    float px = v_uv.x * u_size.x;
    float py = v_uv.y * u_size.y;
    float idx = floor(px / slot);
    float inSeg = px - idx * slot;
    float segW = slot - gapPx;
    if (inSeg > segW || idx >= u_n) { gl_FragColor = vec4(0.0); return; }
    vec2 hs = vec2(segW, u_size.y) * 0.5;
    vec2 p = vec2(inSeg, py) - hs;
    float r = u_round > 0.5 ? min(hs.x, hs.y) : min(4.0, hs.y);
    if (u_round > 0.5) hs = vec2(r);
    p = vec2(inSeg, py) - vec2(segW, u_size.y) * 0.5;
    vec2 q = abs(p) - (hs - vec2(r));
    float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
    float cover = clamp(0.5 - d, 0.0, 1.0);
    float nMain = max(1.0, u_n - u_tail);
    float f = idx / max(1.0, nMain - 1.0);
    vec3 col = idx >= nMain ? u_blue : (f < 0.42 ? u_green : (f < 0.75 ? u_yellow : u_red));
    bool on = idx < u_lit;
    if (u_strobe > 0.5) { col = u_red; on = true; }
    gl_FragColor = vec4(col, cover * (on ? 1.0 : u_off));
}
`;

const FILL = `// Solid fill for a cluster-render "effect" layer (GLSL ES 1.00): u_color everywhere, except a
// see-through rounded hole u_hole (x, y, w, h px from the layer's top left; w = 0: no hole), radius u_holeR.
// On the cluster, an opaque fill hides BMW's own gauges under it; the hole lets the map window show.
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;     // px-scale maths: mediump is fp16 on the car's GPU (x*x+y*y overflows past ~256 px)
#else
precision mediump float;
#endif
varying vec2 v_uv;
uniform vec2 u_size;
uniform vec4 u_color;
uniform vec4 u_hole;
uniform float u_holeR;

void main() {
    vec2 p = vec2(v_uv.x * u_size.x, v_uv.y * u_size.y);
    float a = u_color.a;
    if (u_hole.z > 0.0) {
        vec2 hs = u_hole.zw * 0.5;
        vec2 q = abs(p - (u_hole.xy + hs)) - (hs - vec2(u_holeR));
        float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - u_holeR;
        a *= clamp(d + 0.5, 0.0, 1.0);
    }
    gl_FragColor = vec4(u_color.rgb, a);
}
`;

const BOX = `// Framed box for a cluster-render "effect" layer (GLSL ES 1.00), the race-dash readout box: a rounded
// frame u_border px wide in u_line, filled u_fill, with a header strip u_headH px tall in u_head across the
// top (0 = none). Colours rgba, straight alpha. u_size, u_border, u_headH, u_radius in px.
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;     // px-scale maths: mediump is fp16 on the car's GPU (x*x+y*y overflows past ~256 px)
#else
precision mediump float;
#endif
varying vec2 v_uv;
uniform vec2 u_size;
uniform vec4 u_fill;
uniform vec4 u_line;
uniform vec4 u_head;
uniform float u_headH;
uniform float u_border;
uniform float u_radius;

void main() {
    vec2 p = vec2(v_uv.x * u_size.x, v_uv.y * u_size.y);
    vec2 hs = u_size * 0.5;
    vec2 q = abs(p - hs) - (hs - vec2(u_radius));
    float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - u_radius;   // < 0 inside
    float outer = clamp(0.5 - d, 0.0, 1.0);
    if (outer <= 0.0) { gl_FragColor = vec4(0.0); return; }
    vec4 c = p.y < u_headH ? u_head : u_fill;
    float edge = clamp(d + u_border + 0.5, 0.0, 1.0);                       // 1 within the frame
    vec4 col = mix(c, u_line, edge);
    gl_FragColor = vec4(col.rgb, col.a * outer);
}
`;

const BOXES = `// The GT3 race dash's frame in one cluster-render "effect" layer (GLSL ES 1.00): the background u_bg over the
// whole layer, a see-through rounded hole for BMW's map (u_hole x, y, w, h in layer px, already inset; w 0 = none;
// corner radius u_holeR) and up to 12 framed readout boxes from the layout: each a rounded frame in u_line, filled
// u_fill, with a header strip across its top in u_head (or u_accent). Array uniforms (sent with type vec4):
//   u_box[i]       x, y, w, h in layer px
//   u_boxStyle[i]  header height px, border px, corner radius px, header kind (0 u_head, 1 u_accent)
//   u_n            boxes in use (the rest are skipped). Boxes must not overlap each other or the hole.
// Colours rgba, straight alpha. The loop bound is constant and the arrays are indexed by the loop counter only,
// as GLSL ES 1.00 requires.
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;     // px-scale maths: mediump is fp16 on the car's GPU (x*x+y*y overflows past ~256 px)
#else
precision mediump float;
#endif
varying vec2 v_uv;
uniform vec2 u_size;
uniform vec4 u_bg;
uniform vec4 u_hole;
uniform float u_holeR;
uniform float u_n;
uniform vec4 u_box[12];
uniform vec4 u_boxStyle[12];
uniform vec4 u_fill;
uniform vec4 u_line;
uniform vec4 u_head;
uniform vec4 u_accent;

// signed distance to the rounded rect r (x, y, w, h), radius rad; < 0 inside
float sdBox(vec2 p, vec4 r, float rad) {
    vec2 hs = r.zw * 0.5;
    vec2 q = abs(p - (r.xy + hs)) - (hs - vec2(rad));
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - rad;
}
vec4 over(vec4 top, vec4 under) {           // straight-alpha "top over under"
    float a = top.a + under.a * (1.0 - top.a);
    if (a <= 0.0) return vec4(0.0);
    return vec4((top.rgb * top.a + under.rgb * under.a * (1.0 - top.a)) / a, a);
}

void main() {
    vec2 p = v_uv * u_size;
    vec4 c = u_bg;
    if (u_hole.z > 0.0) c.a *= clamp(sdBox(p, u_hole, u_holeR) + 0.5, 0.0, 1.0);
    for (int i = 0; i < 12; i++) {
        if (float(i) >= u_n) break;
        vec4 b = u_box[i];
        vec4 s = u_boxStyle[i];
        if (p.x < b.x - 1.0 || p.x > b.x + b.z + 1.0 || p.y < b.y - 1.0 || p.y > b.y + b.w + 1.0) continue;
        float d = sdBox(p, b, s.z);
        float outer = clamp(0.5 - d, 0.0, 1.0);
        if (outer <= 0.0) continue;
        vec4 inner = p.y < b.y + s.x ? (s.w > 0.5 ? u_accent : u_head) : u_fill;
        float edge = clamp(d + s.y + 0.5, 0.0, 1.0);               // 1 within the frame
        vec4 col = mix(inner, u_line, edge);
        c = over(vec4(col.rgb, col.a * outer), c);
    }
    gl_FragColor = c;
}
`;

const GRID = `// Calibration grid for a cluster-render "effect" layer (GLSL ES 1.00): a line every u_step px, a brighter
// one every u_major steps, a frame round the edge. v_uv (0,0) is the top-left.
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;     // px-scale maths: mediump is fp16 on the car's GPU (x*x+y*y overflows past ~256 px)
#else
precision mediump float;
#endif
varying vec2 v_uv;
uniform vec2 u_size;
uniform float u_step;
uniform float u_major;
uniform vec4 u_minor;
uniform vec4 u_majorC;

void main() {
    vec2 p = v_uv * u_size;
    vec2 m = mod(p, u_step);
    vec2 big = mod(p, u_step * u_major);
    bool edge = p.x < 2.0 || p.y < 2.0 || p.x > u_size.x - 2.0 || p.y > u_size.y - 2.0;
    if (edge || big.x < 2.0 || big.y < 2.0) gl_FragColor = u_majorC;
    else if (m.x < 1.0 || m.y < 1.0) gl_FragColor = u_minor;
    else gl_FragColor = vec4(0.0);
}
`;

const SEGBAR = `// Segmented level bar for a cluster-render "effect" layer (GLSL ES 1.00): u_segs segments, the first
// u_lit of them lit (brightening left to right), each slanted u_slant px. v_uv (0,0) is the top-left.
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;     // px-scale maths: mediump is fp16 on the car's GPU (x*x+y*y overflows past ~256 px)
#else
precision mediump float;
#endif
varying vec2 v_uv;
uniform vec2 u_size;
uniform float u_segs;
uniform float u_lit;
uniform vec4 u_on;
uniform vec4 u_offC;
uniform float u_slant;

void main() {
    vec2 p = v_uv * u_size;
    float x = p.x - u_slant * (1.0 - v_uv.y);
    float gap = 8.0;
    float slot = (u_size.x - u_slant + gap) / u_segs;
    float i = floor(x / slot);
    float fx = x - i * slot;
    float a = clamp(fx + 0.5, 0.0, 1.0) * clamp(slot - gap - fx + 0.5, 0.0, 1.0);
    if (i < 0.0 || i >= u_segs || a <= 0.0) { gl_FragColor = vec4(0.0); return; }
    vec4 col = i < u_lit ? vec4(u_on.rgb * mix(0.72, 1.0, fx / (slot - gap)), u_on.a) : u_offC;
    gl_FragColor = vec4(col.rgb, col.a * a);
}
`;

const MDASH = `// The M theme's whole backdrop in one cluster-render "effect" layer (GLSL ES 1.00), traced off a photo of a current
// M8's cluster (design/photos/ref-m8-cluster.png, warped to 1920x720): black, with a near-black card either side whose
// inner edge follows the rev blade, whose top edge is the photo's curve and whose bottom outer corner is a big round;
// the centre line with its bright end caps, the tyre block's car glyph and dividers (the eight values are text widgets),
// the two side dials over the cards (the photo's thin glass bracket, hatched bezel, red streaks), the tricolour mark
// and the four setup level bars (slanted segments, the one at the level red, the rest grey, as the M8 draws them).
// Positions in target px from the layout (hud.js). v_uv (0,0) is the top-left.
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;     // px-scale maths: mediump is fp16 on the car's GPU (x*x+y*y overflows past ~256 px)
#else
precision mediump float;
#endif
#endif
varying vec2 v_uv;
uniform vec2 u_size;
uniform vec4 u_card;      // left card: outer edge x, bottom y, bottom-outer corner radius, top-outer corner rounding (the right card is its mirror)
uniform vec3 u_cardCutR;  // the right card's lower outer corner, cut back on a circle (mirrored frame: cx, cy, r; r 0 = none): the M8's
                          // right card is cut further than its left one, so the oil dial's numbers sit on black
uniform vec3 u_cardTop;   // the left card's top edge, y = a x^2 + b x + c (traced off the M8 photo)
uniform float u_cardFill; // the card's grey level 0..1 (0 = black, outline only)
uniform vec4 u_blade;     // the left rev blade's outer edge: x at the bend, y of the bend, x per y px above / below it
uniform vec2 u_bladeB;    // the bend's roundness px, the card's gap from the blade px
uniform vec4 u_line;      // centre line x0, y, x1, cap length
uniform vec3 u_tyre;      // the tyre block's car glyph: centre x, y, scale (0 = none)
uniform vec4 u_gaugeL;    // left gauge centre x, y, radius, value 0..1
uniform vec4 u_gaugeR;    // right gauge
uniform vec3 u_mark;      // tricolour mark x, y, scale (0 = none)
uniform vec3 u_red;
uniform vec4 u_seg0;      // setup level bars x, y, w, h (a height of 0: none)
uniform vec4 u_seg1;
uniform vec4 u_seg2;
uniform vec4 u_seg3;
uniform vec4 u_segLit;    // the level per bar (1-based; 0 = none lit)
uniform vec4 u_segMax;    // segments per bar
uniform float u_segSlant; // px each segment leans
uniform vec4 u_hole;      // the map window x, y, w, h px, already inset (w 0 = none): cut see-through over the map
uniform float u_holeR;    // its corner radius px

const float PI = 3.14159265;

float cov(float d) { return clamp(0.5 - d, 0.0, 1.0); }
vec4 over(vec4 top, vec4 under) {
    float a = top.a + under.a * (1.0 - top.a);
    if (a <= 0.0) return vec4(0.0);
    return vec4((top.rgb * top.a + under.rgb * under.a * (1.0 - top.a)) / a, a);
}
float segD(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }

float sdRoundBox(vec2 p, vec4 r, float rad) {
    vec2 c = r.xy + r.zw * 0.5;
    vec2 q = abs(p - c) - r.zw * 0.5 + rad;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - rad;
}
float angOf(vec2 d) { float a = atan(d.x, -d.y); return a < 0.0 ? a + 2.0 * PI : a; }
// the left blade's outer edge x at y (mtach's curve)
float bladeX(float y) {
    float dy = y - u_blade.y;
    float k = dy < 0.0 ? u_blade.z : u_blade.w;
    return u_blade.x + k * (sqrt(dy * dy + u_bladeB.x * u_bladeB.x) - u_bladeB.x);
}
// smooth intersection of two signed distances (rounds the corner where they meet)
float smax(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (a - b) / k, 0.0, 1.0); return mix(b, a, h) + k * h * (1.0 - h); }
// the left card as the M8 draws it: a wedge whose top edge is the traced curve, outer edge at u_card.x, bottom at
// u_card.y, inner side along the blade; the bottom-outer corner is a big round (the fuel dial sits over it); < 0 inside
float cardD(vec2 p, float right) {
    float fx = u_cardTop.x * p.x * p.x + u_cardTop.y * p.x + u_cardTop.z;
    float slope = 2.0 * u_cardTop.x * p.x + u_cardTop.y;
    float dTop = (fx - p.y) / sqrt(1.0 + slope * slope);
    float dLeft = u_card.x - p.x;
    float dBot = p.y - u_card.y;
    float d = smax(dTop, dLeft, u_card.w);
    d = max(d, dBot);
    vec2 cc = vec2(u_card.x + u_card.z, u_card.y - u_card.z);
    if (p.x < cc.x && p.y > cc.y) d = max(d, length(p - cc) - u_card.z);
    d = max(d, p.x - (bladeX(p.y) - u_bladeB.y));
    if (right > 0.5 && u_cardCutR.z > 0.0) d = max(d, length(p - u_cardCutR.xy) - u_cardCutR.z);
    return d;
}
// the card: near-black (the panel brightens every dark tint, so the fill stays tiny), a shade lighter and bluer at
// the top, with a faint lighter rim
vec4 card(vec2 p, vec2 dial, float right, vec4 c) {
    float d = cardD(p, right);
    if (d > 2.0) return c;
    float top = u_cardTop.z - u_cardTop.y * u_cardTop.y / (4.0 * u_cardTop.x);   // the curve's lowest y (its vertex)
    float fy = clamp((p.y - top) / max(u_card.y - top, 1.0), 0.0, 1.0);
    float grey = u_cardFill * mix(1.3, 0.75, fy);
    c = over(vec4(vec3(grey, grey, grey * 1.18), cov(d)), c);
    // the rim stops inside the dial's area (as on the M8, where the dial covers the card's edge), so no label sits on it;
    // 118..130 px at the photo's dial size (r 120), scaled with the layout's
    float kd = u_gaugeL.z / 120.0;
    float hide = 1.0 - smoothstep(118.0 * kd, 130.0 * kd, length(p - dial));
    c = over(vec4(0.5, 0.53, 0.58, 0.3 * cov(abs(d + 1.2) - 0.9) * (1.0 - hide)), c);
    return c;
}
// the tyre block: the car seen from above (outline body, four wheels) between the four readouts,
// a divider under each front pair, a tick above and below the car
vec4 tyreBlock(vec2 p, vec4 c) {
    if (u_tyre.z <= 0.0) return c;
    vec2 q = (p - u_tyre.xy) / u_tyre.z;
    if (abs(q.x) > 80.0 || abs(q.y) > 70.0) return c;
    float body = abs(sdRoundBox(q, vec4(-11.0, -20.0, 22.0, 40.0), 7.0)) - 1.1;
    vec2 a = vec2(abs(q.x) - 13.5, abs(q.y) - 11.0);
    float wheel = max(abs(a.x) - 2.2, abs(a.y) - 4.5);
    float hl = min(segD(q, vec2(-68.0, 0.0), vec2(-28.0, 0.0)), segD(q, vec2(28.0, 0.0), vec2(68.0, 0.0))) - 0.9;
    float vt = min(segD(q, vec2(0.0, -62.0), vec2(0.0, -42.0)), segD(q, vec2(0.0, 42.0), vec2(0.0, 62.0))) - 0.9;
    c = over(vec4(0.72, 0.76, 0.82, cov(min(body, min(hl, vt)) * u_tyre.z)), c);
    c = over(vec4(0.36, 0.78, 0.42, cov(wheel * u_tyre.z)), c);
    return c;
}
// a setup level bar: s.y segments slanted, number lit (1-based) red, the rest grey
vec4 segbar(vec2 p, vec4 b, vec2 s, vec4 c) {
    if (b.w <= 0.0 || p.y < b.y - 1.0 || p.y > b.y + b.w + 1.0 || p.x < b.x - 1.0 || p.x > b.x + b.z + 1.0) return c;
    float fy = (p.y - b.y) / b.w;
    float x = p.x - b.x - u_segSlant * (1.0 - fy);
    float gap = 10.0;
    float slot = (b.z - u_segSlant + gap) / s.y;
    float i = floor(x / slot);
    float fx = x - i * slot;
    float a = clamp(fx + 0.5, 0.0, 1.0) * clamp(slot - gap - fx + 0.5, 0.0, 1.0) * clamp(p.y - b.y + 0.5, 0.0, 1.0) * clamp(b.y + b.w - p.y + 0.5, 0.0, 1.0);
    if (i < 0.0 || i >= s.y || a <= 0.0) return c;
    bool on = abs(i + 1.0 - s.x) < 0.5;
    vec3 col = on ? u_red * mix(0.85, 1.0, fx / (slot - gap)) : vec3(0.5, 0.53, 0.58);
    return over(vec4(col, (on ? 1.0 : 0.8) * a), c);
}

// a side dial as the M8 draws it, traced off the photo: not a round gauge but a tall thin bracket cut from big
// circles. The glass lies inside a circle of radius 120 round the anchor g.xy and outside one of radius 180 round
// (57, -68), so it is ~20 px wide at the top and widens to ~50 at the bottom; a hatched chrome bezel (an arc between
// radii 113 and 124 round (-13, 11)) runs down its outer side. The level reads by height: the glass is lit from the
// bottom up to the level, dark above it (a thin bright line along its outer edge), and a horizontal red streak runs in
// from the outer edge at the level. Fixed streaks mark the end zones (zones 0, fuel: the reserve at the bottom; 1, oil:
// blue at the cold bottom end, red at the hot top end). Units are the photo's px with g.z = 120 there.
// Drawn in the left frame; the right dial comes through the mirror.
vec4 streak(vec2 q, float py, float len, vec3 col, float k, vec4 c) {
    float xo = -sqrt(max(14400.0 - py * py, 0.0)) - 3.0;                         // the glass's outer edge at that height
    float dx = q.x - (xo + len * 0.5), dy = abs(q.y - py);
    float taper = 1.0 - clamp(abs(dx) / (len * 0.5), 0.0, 1.0);
    float sd = (max(abs(dx) - len * 0.5, dy - (1.2 + 2.3 * taper))) * k;
    c = over(vec4(col, 0.3 * exp(-max(sd, 0.0) / (5.0 * k))), c);
    return over(vec4(mix(col, vec3(1.0, 0.55, 0.5), 0.25 * taper), cov(sd)), c);
}
vec4 gauge(vec2 p, vec4 g, float zones, vec4 c) {
    float k = g.z / 120.0;
    vec2 q = (p - g.xy) / k;
    if (q.x < -140.0 || q.x > 70.0 || q.y < -22.0 || q.y > 140.0) return c;
    float v = clamp(g.w, 0.0, 1.0);
    // the bezel: double-edged and hatched, from its top end down round to its bottom end
    vec2 qb = q - vec2(-13.0, 11.0);
    float rb = length(qb);
    if (q.y > -16.0 && q.x < -30.0 && rb > 111.0 && rb < 126.0) {
        float ab = atan(qb.y, qb.x);
        float hatch = step(0.5, fract(ab * 30.0));
        float edge = max(cov((abs(rb - 112.5)) * k - 0.8), cov((abs(rb - 124.0)) * k - 0.8));
        float body = (rb > 112.5 && rb < 124.0) ? 0.4 + 0.35 * hatch : 0.0;
        c = over(vec4(0.8, 0.82, 0.88, min(1.0, body + 0.7 * edge)), c);
    }
    // the glass
    float dOut = 120.0 - length(q);
    float dIn = length(q - vec2(57.0, -68.0)) - 180.0;
    float inside = min(min(dOut, dIn), min(q.y + 10.0, 14.0 - q.x));
    if (zones > 0.5) inside = min(min(inside, 104.0 - q.y), -30.0 - q.x);       // the oil glass ends higher and shorter (photo: y 564, x 1686)
    if (inside > -1.5) {
        float f = clamp(dOut / max(dOut + max(dIn, 0.0), 1.0), 0.0, 1.0);        // 0 at the outer edge, 1 at the inner
        float yv = zones > 0.5 ? mix(97.0, 7.0, v) : mix(100.0, 2.0, v);
        float lit = smoothstep(yv - 2.0, yv + 4.0, q.y);
        vec4 dark = vec4(0.85, 0.87, 0.92, 0.75 * (1.0 - smoothstep(0.0, 6.0, dOut)));
        vec4 bright = vec4(mix(vec3(0.96, 0.97, 0.99), vec3(0.55, 0.57, 0.63), f), mix(1.0, 0.55, f));
        vec4 glass = mix(dark, bright, lit);
        c = over(vec4(glass.rgb, glass.a * cov(-inside * k)), c);
        c = over(vec4(1.0, 1.0, 1.0, 0.7 * cov(abs(inside * k) - 0.6) * (1.0 - lit) * step(dOut, 3.0)), c);
    }
    float yv = zones > 0.5 ? mix(97.0, 7.0, v) : mix(100.0, 2.0, v);
    if (zones > 0.5) {
        c = streak(q, -8.0, 44.0, u_red, k, c);                                    // hot end, above the top label as the photo
        c = streak(q, 101.0, 34.0, vec3(0.3, 0.55, 1.0), k, c);                    // cold end, along the glass's bottom
    } else {
        c = streak(q, 112.0, 50.0, u_red, k, c);                                   // reserve
    }
    c = streak(q, yv, 38.0, u_red, k, c);                                          // the level, across the glass only
    return c;
}

void main() {
    vec2 p = v_uv * u_size;
    vec2 pm = vec2(u_size.x - p.x, p.y);        // the right half, mirrored into the left frame
    vec4 c = vec4(0.0, 0.0, 0.0, 1.0);           // black, as the M8

    // the two cards: the left one as laid out, the right one its mirror
    c = card(p, u_gaugeL.xy, 0.0, c);
    c = card(pm, vec2(u_size.x - u_gaugeR.x, u_gaugeR.y), 1.0, c);

    // centre line, bright caps at both ends
    if (abs(p.y - u_line.y) < 6.0) {
        c = over(vec4(0.62, 0.66, 0.73, 0.8 * cov(segD(p, u_line.xy, u_line.zy) - 1.6)), c);
        float l = segD(p, u_line.xy + vec2(6.0, 0.0), u_line.xy + vec2(u_line.w, 0.0)) - 2.0 - 1.2 * clamp((p.x - u_line.x) / u_line.w, 0.0, 1.0);
        float r = segD(p, u_line.zy - vec2(u_line.w, 0.0), u_line.zy - vec2(6.0, 0.0)) - 2.0 - 1.2 * clamp((u_line.z - p.x) / u_line.w, 0.0, 1.0);
        c = over(vec4(0.95, 0.96, 0.98, cov(min(l, r))), c);
    }

    c = tyreBlock(p, c);

    // the side dials, traced off the M8 photo: the glass crescent, the fuel one as laid out, the oil one its mirror
    c = gauge(p, u_gaugeL, 0.0, c);
    c = gauge(pm, vec4(u_size.x - u_gaugeR.x, u_gaugeR.yzw), 1.0, c);

    c = segbar(p, u_seg0, vec2(u_segLit.x, u_segMax.x), c);
    c = segbar(p, u_seg1, vec2(u_segLit.y, u_segMax.y), c);
    c = segbar(p, u_seg2, vec2(u_segLit.z, u_segMax.z), c);
    c = segbar(p, u_seg3, vec2(u_segLit.w, u_segMax.w), c);

    // the map window between the rev blades ("Show Waze map inside the theme"): a rounded see-through hole
    if (u_hole.z > 0.0) {
        vec2 hs = u_hole.zw * 0.5;
        vec2 q = abs(p - (u_hole.xy + hs)) - (hs - vec2(u_holeR));
        float hd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - u_holeR;
        c.a *= clamp(hd + 0.5, 0.0, 1.0);
    }

    // tricolour mark: three slanted bars
    if (u_mark.z > 0.0) {
        vec2 m = (p - u_mark.xy) / u_mark.z;
        if (m.y > -1.0 && m.y < 21.0 && m.x > -2.0 && m.x < 60.0) {
            float lx = m.x - 7.0 * (1.0 - m.y / 20.0);
            float i = floor(lx / 16.0);
            float fx = lx - i * 16.0;
            float inside = cov((max(abs(fx - 6.5) - 6.5, abs(m.y - 10.0) - 10.0)) * u_mark.z);
            vec3 mc = i < 0.5 ? vec3(0.31, 0.71, 1.0) : (i < 1.5 ? vec3(0.17, 0.29, 0.78) : vec3(0.9, 0.13, 0.17));
            if (i >= 0.0 && i <= 2.0) c = over(vec4(mc, inside), c);
        }
    }
    gl_FragColor = c;
}
`;
const MTACH = `// The M theme's rev bar (GLSL ES 1.00), after the M8's: a bowed glass blade (the curve bends at u_geoA.z with a
// large roundness, so it reads as one arc), wide at 0 rpm and narrow at the top, with a bright silver outer
// edge and bright ticks running in from it every 1000 rpm. The part below the rpm is lit dim grey, a glowing red
// block rides the blade at the rpm (the M8's marker), an outlined grey foot block fills the bottom 20 px, orange dashes sit before
// the redline and a solid red line past it. Drawn as the left bar; u_side 1 mirrors it. v_uv (0,0) is the top-left.
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;     // px-scale maths: mediump is fp16 on the car's GPU (x*x+y*y overflows past ~256 px)
#else
precision mediump float;
#endif
#endif
varying vec2 v_uv;
uniform vec2 u_size;
uniform float u_side;
uniform vec4 u_geoA;      // y at 0 rpm, y at max, y of the bend, outer-edge x at the bend (layer px, left frame)
uniform vec3 u_geoB;      // slope above the bend, slope below it, bend roundness px
uniform vec3 u_wid;       // blade width at 0 rpm, at max, extra at the bend
uniform float u_ticks;    // max / 1000
uniform float u_value;    // 0..1
uniform float u_orange;   // 0..1, orange dashes from here
uniform float u_redFrom;  // 0..1, red dashes from here (the redline)
uniform float u_shiftNow;
uniform vec3 u_red;

float cov(float d) { return clamp(0.5 - d, 0.0, 1.0); }
vec4 over(vec4 top, vec4 under) {
    float a = top.a + under.a * (1.0 - top.a);
    if (a <= 0.0) return vec4(0.0);
    return vec4((top.rgb * top.a + under.rgb * under.a * (1.0 - top.a)) / a, a);
}
float segD(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }

void main() {
    vec2 p = v_uv * u_size;
    if (u_side > 0.0) p.x = u_size.x - p.x;
    float y0 = u_geoA.x, y8 = u_geoA.y, ym = u_geoA.z, xm = u_geoA.w;
    float dy = p.y - ym;
    float k = dy < 0.0 ? u_geoB.x : u_geoB.y;
    float sq = sqrt(dy * dy + u_geoB.z * u_geoB.z);
    float xo = xm + k * (sq - u_geoB.z);
    float slope = k * dy / sq;
    float d = (p.x - xo) / sqrt(1.0 + slope * slope);      // + = into the blade, towards the middle
    float t = (y0 - p.y) / (y0 - y8);
    float w = mix(u_wid.x, u_wid.y, clamp(t, 0.0, 1.0)) + u_wid.z * exp(-dy * dy / 22000.0);
    vec4 c = vec4(0.0);
    if (t >= 0.0 && t <= 1.0) {
        float inBand = clamp(d + 0.5, 0.0, 1.0) * clamp(w - d + 0.5, 0.0, 1.0);
        float across = clamp(d / w, 0.0, 1.0);
        float yn = y0 - u_value * (y0 - y8);
        vec4 g = vec4(0.62, 0.67, 0.74, mix(0.42, 0.06, across));          // empty glass (bright at the outer edge, as the M8's)
        if (p.y > yn) g = u_shiftNow > 0.5 ? vec4(u_red * 0.8, 0.6) : vec4(mix(vec3(0.86, 0.88, 0.92), vec3(0.6, 0.63, 0.68), across), mix(0.34, 0.22, across));
        // the foot: the bottom 20 px as an outlined grey block, as the M8 draws it
        if (p.y > y0 - 20.0) g = over(vec4(0.7, 0.72, 0.78, 0.22), g);
        g = over(vec4(0.9, 0.92, 0.95, 0.7 * cov(min(abs(p.y - (y0 - 19.0)), abs(p.y - (y0 - 1.5))) - 0.8)), g);
        // the marker: a red block at the rpm with a glow either side of it
        float dm = abs(p.y - yn);
        g = over(vec4(u_red, 0.5 * exp(-dm / 26.0)), g);
        g = over(vec4(mix(u_red, vec3(1.0, 0.45, 0.4), 0.35 * cov(dm - 5.0)), cov(dm - 14.0)), g);
        c = vec4(g.rgb, g.a * inBand);
        c = over(vec4(0.93, 0.95, 0.98, cov(abs(d) - 1.6)), c);               // outer edge
        c = over(vec4(1.0, 1.0, 1.0, 0.3 * cov(abs(d - 4.0) - 0.6)), c);       // its bevel
        c = over(vec4(0.66, 0.7, 0.76, 0.75 * cov(abs(d - w) - 0.8)), c);      // inner edge
        // BMW's marks: a solid red line from the redline, a few orange dashes in the run-up to it
        bool redM = t >= u_redFrom && d > 6.0 && d < 11.0;
        bool orM = t >= u_orange && t < u_redFrom - 0.01 && d > 6.0 && d < 11.0 && mod(p.y, 20.0) < 7.0;
        if (redM || orM) {
            c = over(vec4(redM ? u_red : vec3(1.0, 0.6, 0.1), 0.95), c);
        }
    }
    // ticks every 1000 rpm: bright, from the outer edge 24 px into the glass, as the M8 draws them
    float kk = floor(t * u_ticks + 0.5);
    float yk = y0 - kk / u_ticks * (y0 - y8);
    if (kk >= 0.0 && kk <= u_ticks && d > -2.0 && d < 24.0) {
        float ty = abs(p.y - yk) - 1.5;
        c = over(vec4(0.93, 0.95, 0.98, cov(ty)), c);
    }
    gl_FragColor = c;
}
`;
const SDASH = `// The Sport theme in one cluster-render "effect" layer (GLSL ES 1.00), after BMW's Live Cockpit Sport view:
// a blue speed bracket left and a red rev bracket right (the left one mirrored). Each is a thin bright outer
// line, a band that fills from the bottom (white marker at the value), a dark gap and a thin inner line round a
// black middle: plain black, or the map through a see-through rounded hole (u_hole; only the bottom strip draws
// over it, the fuel and oil bars are off while it is open). Two-tone fuel and oil bars inside the brackets, a blue / red strip at the bottom. v_uv (0,0) is
// the top-left. The backdrop is pure black: the car brightens dark tints (seen Nov 5 2026), so no dark panels.
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;     // px-scale maths: mediump is fp16 on the car's GPU (x*x+y*y overflows past ~256 px)
#else
precision mediump float;
#endif
#endif
varying vec2 v_uv;
uniform vec2 u_size;
uniform vec4 u_geo;       // outer line: y at the top, y at the bend, y at the bottom, x at the bend (left side)
uniform vec3 u_k;         // x per y px above the bend, below it, bend roundness px
uniform float u_w;        // band width
uniform float u_inner;    // the inner line's distance from the outer line
uniform vec2 u_scale;     // y of the scale's 0 and of its top mark
uniform vec2 u_ticks;     // marks left (speed), right (rpm)
uniform float u_speed;    // 0..1 along the scale
uniform float u_rpm;      // 0..1
uniform float u_redFrom;  // 0..1 (the redline)
uniform float u_orange;   // 0..1, yellow marks from here to the redline
uniform float u_fuel;     // 0..1
uniform float u_oil;      // 0..1
uniform vec4 u_fuelSeg;   // full end x, y, empty end x, y
uniform vec4 u_oilSeg;
uniform vec4 u_hole;      // map window x, y, w, h, already inset (w 0 = none)
uniform float u_holeR;    // the hole's corner radius px
uniform vec4 u_strip;     // bottom strip: left end x, top y, height, slant px
uniform float u_topEnd;   // the top lines run from the bracket to this x (left; mirrored on the right)

const vec3 BLUE_LINE = vec3(0.36, 0.62, 1.0);
const vec3 BLUE_BAND = vec3(0.13, 0.3, 0.78);
const vec3 BLUE_LIT = vec3(0.62, 0.86, 1.0);
const vec3 BLUE_IN = vec3(0.2, 0.45, 0.98);
const vec3 RED_LINE = vec3(0.95, 0.12, 0.16);
const vec3 RED_BAND = vec3(0.33, 0.06, 0.1);
const vec3 RED_LIT = vec3(0.93, 0.1, 0.15);
const vec3 RED_IN = vec3(0.86, 0.08, 0.13);

float cov(float d) { return clamp(0.5 - d, 0.0, 1.0); }
vec4 over(vec4 top, vec4 under) {
    float a = top.a + under.a * (1.0 - top.a);
    if (a <= 0.0) return vec4(0.0);
    return vec4((top.rgb * top.a + under.rgb * under.a * (1.0 - top.a)) / a, a);
}
float segD(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
float segH(vec2 p, vec2 a, vec2 b) { vec2 ba = b - a; return clamp(dot(p - a, ba) / dot(ba, ba), 0.0, 1.0); }

float outerX(float y) {
    float dy = y - u_geo.y;
    float k = dy < 0.0 ? u_k.x : u_k.y;
    return u_geo.w + k * (sqrt(dy * dy + u_k.z * u_k.z) - u_k.z);
}
float outerSlope(float y) {
    float dy = y - u_geo.y;
    float k = dy < 0.0 ? u_k.x : u_k.y;
    return k * dy / sqrt(dy * dy + u_k.z * u_k.z);
}
// px from the outer line, inwards (perpendicular)
float dIn(vec2 q) { return (q.x - outerX(q.y)) / sqrt(1.0 + outerSlope(q.y) * outerSlope(q.y)); }

// one bracket in the left frame (q mirrored for the right one)
vec4 bracket(vec2 q, float val, float redFrom, float orange, float ticks, vec3 line, vec3 band, vec3 lit, vec3 inner, vec4 c) {
    float d = dIn(q);
    float yTopI = u_geo.x + 8.0;                              // the inner line's top run
    float t = (u_scale.x - q.y) / (u_scale.x - u_scale.y);    // 0 at the scale's 0
    bool inY = q.y > u_geo.x + 5.0 && q.y < u_geo.z - 4.0;
    // the band: lit up to the value, white marker on top
    float inB = (inY ? 1.0 : 0.0) * cov(-(d - 5.0)) * cov(d - 5.0 - u_w);
    if (inB > 0.0) {
        vec3 col = band;
        float a = 0.96;
        if (t <= val) col = mix(lit, mix(lit, vec3(1.0), 0.25), clamp((d - 5.0) / u_w, 0.0, 1.0)) * mix(0.8, 1.0, clamp(t / max(val, 0.01), 0.0, 1.0));
        c = over(vec4(col, a * inB), c);
        float yv = u_scale.x - val * (u_scale.x - u_scale.y);
        if (val > 0.002) c = over(vec4(1.0, 1.0, 1.0, inB * cov(abs(q.y - yv) - 2.0)), c);
        // marks at every label, on the band's outer half
        float kk = floor(t * ticks + 0.5);
        float yk = u_scale.x - kk / ticks * (u_scale.x - u_scale.y);
        if (kk >= 0.0 && kk <= ticks && d > 7.0 && d < 19.0) c = over(vec4(line, 0.9 * cov(abs(q.y - yk) - 1.2)), c);
        // redline: yellow dashes, then a solid red line, on the outer edge of the band
        if (redFrom < 1.5 && d > 8.0 && d < 13.0) {
            if (t >= redFrom && t <= 1.02) c = over(vec4(1.0, 0.2, 0.2, 1.0), c);
            else if (t >= orange && t < redFrom && mod(q.y, 16.0) < 7.0) c = over(vec4(1.0, 0.85, 0.1, 1.0), c);
        }
    }
    // the outer line, its top run and its bottom run
    float o = inY || abs(q.y - u_geo.x) < 6.0 || abs(q.y - u_geo.z) < 6.0 ? cov(abs(d - 1.0) - 1.8) : 0.0;
    vec2 tl = vec2(outerX(u_geo.x), u_geo.x), bl = vec2(outerX(u_geo.z), u_geo.z);
    o = max(o, cov(segD(q, tl, vec2(u_topEnd, u_geo.x)) - 2.2));
    o = max(o, cov(segD(q, bl, bl + vec2(u_inner + 40.0, 0.0)) - 2.2));
    c = over(vec4(line, 0.35 * exp(-abs(d) / 5.0) * (inY ? 1.0 : 0.0) * step(d, 0.0)), c);
    c = over(vec4(line, o), c);
    // the inner line: down the bracket from its top run to the bottom
    float il = (q.y > yTopI && q.y < u_geo.z - 6.0) ? cov(abs(d - u_inner) - 1.6) : 0.0;
    float xi = outerX(yTopI) + u_inner * sqrt(1.0 + outerSlope(yTopI) * outerSlope(yTopI));
    il = max(il, cov(segD(q, vec2(xi, yTopI), vec2(u_topEnd - 14.0, yTopI)) - 1.6));
    c = over(vec4(inner, 0.95 * il), c);
    return c;
}

// a two-tone slanted bar from the empty end b to the full end a, with a thin rail beside it
vec4 bar(vec2 p, vec4 s, float val, float zones, vec4 c) {
    vec2 a = s.xy, b = s.zw;
    float h = 1.0 - segH(p, a, b);
    vec2 dir = normalize(a - b), nrm = vec2(-dir.y, dir.x);
    float side = dot(p - b, nrm);
    float along = segD(p, a, b);
    if (along > 26.0) return c;
    float body = cov(abs(side) - 7.0) * cov(segD(p, a, b) - 7.5);
    vec3 col = vec3(0.92, 0.94, 0.97);
    if (zones > 0.5 && h > 0.88) col = vec3(1.0, 0.2, 0.22);
    if (zones > 0.5 && h < 0.1) col = vec3(0.25, 0.5, 1.0);
    c = over(vec4(0.36, 0.38, 0.44, 0.9 * body), c);
    c = over(vec4(col, body * step(h, val) * step(0.001, val)), c);
    c = over(vec4(0.5, 0.52, 0.58, 0.8 * cov(abs(side + 12.0) - 1.0) * cov(segD(p, a, b) - 13.0)), c);
    return c;
}

void main() {
    vec2 p = v_uv * u_size;
    vec2 pm = vec2(u_size.x - p.x, p.y);
    vec4 c = vec4(0.0, 0.0, 0.0, 1.0);

    c = bracket(p, u_speed, 2.0, 2.0, u_ticks.x, BLUE_LINE, BLUE_BAND, BLUE_LIT, BLUE_IN, c);
    c = bracket(pm, u_rpm, u_redFrom, u_orange, u_ticks.y, RED_LINE, RED_BAND, RED_LIT, RED_IN, c);
    // the map window: a rounded hole cut out of the backdrop and brackets, so the map shows clean; the fuel and
    // oil bars come off while it is open (they ran across the map, car photos Nov 7 2026), the bottom strip stays
    if (u_hole.z > 0.0) {
        vec2 hs = u_hole.zw * 0.5;
        vec2 q = abs(p - (u_hole.xy + hs)) - (hs - vec2(u_holeR));
        float hd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - u_holeR;
        c.a *= clamp(hd + 0.5, 0.0, 1.0);
    } else {
        c = bar(p, u_fuelSeg, u_fuel, 0.0, c);
        c = bar(p, u_oilSeg, u_oil, 1.0, c);
    }
    // the bottom line between the brackets
    if (abs(p.y - u_geo.z) < 3.0 && abs(p.x - u_size.x * 0.5) < u_size.x * 0.5 - outerX(u_geo.z))
        c = over(vec4(mix(BLUE_LINE, RED_LINE, step(u_size.x * 0.5, p.x)) * 0.8, cov(abs(p.y - u_geo.z) - 1.2)), c);

    // bottom strip: slanted ends, blue left of the middle, red right, thin dividers
    float sy = p.y - u_strip.y;
    if (sy > -2.0 && sy < u_strip.z + 2.0) {
        float xl = u_strip.x + (u_strip.z - sy) / u_strip.z * u_strip.w;     // left end leans in at the top
        float dx = abs(p.x - u_size.x * 0.5), xe = u_size.x * 0.5 - xl;
        float inside = cov(dx - xe) * cov(-sy) * cov(sy - u_strip.z);
        float f = dx / xe;
        vec3 sc = p.x < u_size.x * 0.5 ? mix(vec3(0.06, 0.2, 0.62), vec3(0.15, 0.36, 0.92), f) : mix(vec3(0.4, 0.05, 0.1), vec3(0.85, 0.1, 0.16), f);
        c = over(vec4(sc, 0.95 * inside), c);
        float div = cov(abs(mod(p.x - (u_strip.z - sy) * 0.45, 150.0) - 75.0) - 73.8);
        c = over(vec4(0.02, 0.03, 0.08, 0.5 * inside * div), c);
        c = over(vec4(1.0, 1.0, 1.0, 0.25 * inside * cov(abs(sy) - 1.0)), c);
    }
    gl_FragColor = c;
}
`;


const ATEXT = `// Atlas text for a cluster-render "effect" layer (GLSL ES 1.00): u_cells equal cells across the layer, each
// showing one glyph of the R8 glyph atlas bound to u_font (u_grid.x columns by u_grid.y rows of cells), picked
// by the codes in u_text (32 codes, 4 to a vec4; below 0 = empty). A new value is one uniform message, no
// pixels. After robertnisipeanu/idrive-apps js/showcase.js (TEXT_FS). v_uv (0,0) is the top-left.
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_font;
uniform vec4 u_text[8];
uniform float u_cells;
uniform vec2 u_grid;
uniform vec4 u_color;

float code(float cell) {
    float slot = floor(cell / 4.0), lane = cell - slot * 4.0;
    vec4 v = u_text[0];
    for (int i = 1; i < 8; i++) if (float(i) == slot) v = u_text[i];
    return lane < 0.5 ? v.x : lane < 1.5 ? v.y : lane < 2.5 ? v.z : v.w;
}

void main() {
    float x = v_uv.x * u_cells;
    float c = code(floor(x));
    float col = mod(c, u_grid.x), row = floor(c / u_grid.x);
    vec2 uv = vec2((col + fract(x)) / u_grid.x, (row + v_uv.y) / u_grid.y);
    float ink = c < 0.0 ? 0.0 : texture2D(u_font, uv).r;
    gl_FragColor = vec4(u_color.rgb, u_color.a * ink);
}
`;

const DIAL = `// A classic round gauge for a cluster-render "effect" layer (GLSL ES 1.00), the Roadster theme's: a black face, a
// chrome ring (u_ring at the top fading to u_ring2 at the bottom), major and minor ticks round u_sweep from u_start
// (radians, clockwise from 12 o'clock), a red band from u_redFrom (0..1 of the sweep; above 1: none), and a needle
// with a short tail and a centre cap. The numbers are text widgets round it. u_value 0..1 of the sweep.
// u_hot 1: the ring turns the shift red (at the shift point). v_uv (0,0) is the top-left; the dial fills the
// smaller side of the layer.
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;     // px-scale maths: mediump is fp16 on the car's GPU (x*x+y*y overflows past ~256 px)
#else
precision mediump float;
#endif
varying vec2 v_uv;
uniform vec2 u_size;
uniform float u_value;
uniform float u_start;
uniform float u_sweep;
uniform float u_ticks;    // major steps over the sweep (8: 9 marks)
uniform float u_minor;    // minor steps per major step
uniform float u_redFrom;
uniform float u_ringW;    // chrome ring width px
uniform vec3 u_ring;
uniform vec3 u_ring2;
uniform vec3 u_tick;
uniform vec3 u_needle;
uniform vec3 u_red;
uniform vec3 u_face;
uniform float u_hot;

const float PI = 3.14159265359;

// distance from p to the segment a..b
float seg(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h);
}

void main() {
    vec2 p = vec2(v_uv.x - 0.5, 0.5 - v_uv.y) * u_size;   // px from the centre, +y up
    float R = min(u_size.x, u_size.y) * 0.5 - 1.0;
    float d = length(p);
    if (d > R + 0.5) { gl_FragColor = vec4(0.0); return; }
    float edge = clamp(R + 0.5 - d, 0.0, 1.0);
    vec3 col = u_face;
    // the chrome ring, a bright lip on its inner edge
    float rin = R - u_ringW;
    if (d > rin) {
        float t = clamp(0.5 - p.y / (2.0 * R), 0.0, 1.0);
        vec3 ring = mix(u_ring, u_ring2, t);
        if (u_hot > 0.5) ring = mix(ring, u_red, 0.75);
        float lip = clamp(1.0 - (d - rin) / 3.0, 0.0, 1.0);
        col = mix(ring, vec3(1.0), lip * 0.35);
        gl_FragColor = vec4(col, edge);
        return;
    }
    float a = atan(p.x, p.y);
    float rel = mod(a - u_start + 4.0 * PI, 2.0 * PI);
    float inSweep = rel <= u_sweep + 0.02 ? 1.0 : 0.0;
    float tr = rin - 8.0;                          // the ticks' outer end
    // the red band just inside the ticks
    float frac = rel / u_sweep;
    if (inSweep > 0.5 && u_redFrom <= 1.0 && frac >= u_redFrom && d < tr - 2.0 && d > tr - 12.0) col = u_red;
    // ticks: the nearest minor step
    float steps = u_ticks * u_minor;
    float k = floor(frac * steps + 0.5);
    if (k >= 0.0 && k <= steps && inSweep > 0.5) {
        float ta = u_start + k / steps * u_sweep;
        vec2 dir = vec2(sin(ta), cos(ta));
        bool major = mod(k, u_minor) < 0.5;
        float len = major ? 26.0 : 13.0, wid = major ? 2.4 : 1.2;
        float dd = seg(p, dir * (tr - len), dir * tr) - wid;
        float c = clamp(0.5 - dd, 0.0, 1.0);
        vec3 tc = u_redFrom <= 1.0 && k / steps >= u_redFrom - 0.001 ? u_red : u_tick;
        col = mix(col, tc, c);
    }
    // the needle: tapering from the cap to near the ticks, a short tail
    float na = u_start + clamp(u_value, 0.0, 1.0) * u_sweep;
    vec2 nd = vec2(sin(na), cos(na));
    vec2 q = vec2(dot(p, vec2(nd.y, -nd.x)), dot(p, nd));    // across, along the needle
    float L = tr - 4.0;
    if (q.y > -0.18 * L && q.y < L) {
        float hwid = mix(4.5, 1.5, clamp(q.y / L, 0.0, 1.0));
        float c = clamp(hwid + 0.5 - abs(q.x), 0.0, 1.0);
        col = mix(col, u_needle, c);
    }
    // the cap
    if (d < 20.0) col = mix(vec3(0.16), vec3(0.42), clamp((20.0 - d) / 6.0, 0.0, 1.0) * clamp(0.5 + p.y / 40.0, 0.0, 1.0));
    if (d < 20.0 && d > 17.5) col = u_ring2;
    gl_FragColor = vec4(col, edge);
}
`;

// 2026-11-14: the night looks ("nightLook", hud.js NIGHT_LOOKS) as one colour transform at the very end of WBDIAL and
// WBBACK, so the baked static stacks (hud/scene) are recoloured on the GPU, live, with no second set of textures (16 MiB
// pixel memory). A colour splits into its grey part w = min(r, g, b) and what is left over (c - w: the red of the needle,
// the blue of the floor); u_nk0..2 are the output's rows: (red's, green's, blue's image, then the white's image). The
// identity (1 0 0 1, 0 1 0 1, 0 0 1 1) leaves every colour as it is. hud.js sends it always (an unset vec4 is 0: black).
// 2026-11-16 (the owner: "the night themes in Sport and Eco must go"): "#if NIGHT" is resolved in JS like STYLE
// (compact()); NIGHT 0 (hud.js, a 6WB Sport / Eco Pro layout) leaves u_nk0..2 and nightLook() out of the source and
// compact() unwraps every nightLook(x) call to x, so a day-only layer's shader is the smaller one, not a switched-off one.
const NIGHT_GLSL = `#if NIGHT
uniform vec4 u_nk0;
uniform vec4 u_nk1;
uniform vec4 u_nk2;
vec3 nightLook(vec3 c) {
    float w = min(c.r, min(c.g, c.b));
    vec4 v = vec4(c - vec3(w), w);
    return vec3(dot(u_nk0, v), dot(u_nk1, v), dot(u_nk2, v));
}
#endif`;

const WBDIAL = `// 6WB-style round gauges for a cluster-render "effect" layer (GLSL ES 1.00): our own drawing, traced by eye off
// photos of BMW's F-series multifunctional display (no BMW artwork). One shader, five looks (u_style):
//   0 Comfort: a glossy bezel ring (u_ringW px), free-standing ticks (major, half-step, minor) with a red band from
//     u_redFrom, a recessed inner disc with two rims and a "floor", a red ring hub and a red needle with a light
//     core, a white tip and a short tail. u_pre > 0 (the rev dial): a thin arc runs u_pre radians back from the
//     start to an OFF mark, where the needle parks while u_value is below 0. u_box 1: the gear's box at the foot.
//   1 Sport: a glowing band (u_glow) between the centre disc (u_hub of the radius) and the ring, cut by radial
//     hairlines, a short white needle that runs in the band only; the figure sits in the dark disc (a text widget).
//   2 Eco Pro: a white ring with ticks, a glowing inner arc at u_hub, a white needle from the centre.
//   3 mini: a small side gauge: the bezel, a few ticks, a red band below u_redTo and from u_redFrom, a blue one below
//     u_coldTo, a white needle with a ring hub. u_flip 1 mirrors it left-right (the scale then runs anticlockwise).
//   4 Eco Pro's efficiency dial: a thick white arc over the top split at 12 o'clock (CHARGE | POWER), a glowing inner
//     arc, a white pointer from 0.40 R out (its middle stays black: BMW's black box sits there on the G20).
// u_start / u_sweep in radians, clockwise from 12 o'clock; u_value 0..1 of the sweep; u_hot 1: the shift red.
// v_uv (0,0) is the top-left; the dial fills the smaller side of the layer.
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;     // px-scale maths: mediump is fp16 on the car's GPU (x*x+y*y overflows past ~256 px)
#else
precision mediump float;
#endif
varying vec2 v_uv;
// The parameters come packed in vec4s (cluster-render holds up to 32 uniforms a layer, and some GPUs fewer vectors);
// the #defines below give them their old names.
uniform vec4 u_geo;       // layer w, h; bezel width px; flip (1: mirrored)
uniform vec4 u_scale;     // start, sweep (radians cw from 12); major steps; minor steps per major
uniform vec4 u_zone;      // red from, red below, blue below (fractions of the sweep); OFF arc (radians before the start)
uniform vec4 u_mode;      // style; hub (of R); glow strength; gear box (1)
uniform vec4 u_dyn;       // value (0..1 of the sweep); over-speed band from, to; shift red (1)
uniform vec4 u_fill;      // the bottom arc's fill from, to (radians cw from 12, 0..2 pi); baked base kind (0 none; 1 face, shadows,
                          // groove, hub well; 2 the inner disc and floor too; 3 everything static)
uniform vec3 u_ring;
uniform vec3 u_ring2;
uniform vec3 u_tick;
uniform vec3 u_needle;
uniform vec3 u_red;
uniform vec3 u_face;
uniform vec3 u_glow;
uniform sampler2D u_base;  // a baked base texture (hud/scene), RGBA straight alpha
uniform vec4 u_baseR;      // its box in the layer's px: x, y, w, h
uniform sampler2D u_deco;  // the bottom arc's segment coverage (alpha), lit live up to the fill angle
uniform vec4 u_decoR;      // its box in the layer's px (w 0: none)
uniform vec3 u_fillC;      // the lit segments' colour
uniform vec4 u_cut;        // the open bottom (the G20's bottom row shows below it): cut y (layer px from the top; 0: none),
                           // fade (px above it over which the dial fades out), window shape (0 none, 1 round, 2 box,
                           // 3 round closed: the disc stays opaque, the dial fading into black, over BMW's sign), the
                           // window's soft edge (px past its shape until the dial is whole)
uniform vec4 u_cutW;       // the window (BMW's own sign or lamp shows through), layer px: round cx, cy, r; box x0, y0, x1, y1
${NIGHT_GLSL}
#define u_size u_geo.xy
#define u_ringW u_geo.z
#define u_flip u_geo.w
#define u_start u_scale.x
#define u_sweep u_scale.y
#define u_ticks u_scale.z
#define u_minor u_scale.w
#define u_redFrom u_zone.x
#define u_redTo u_zone.y
#define u_coldTo u_zone.z
#define u_pre u_zone.w
// 0.7.13: STYLE (prepended by styled(), shaders.wbdialFor) leaves only that look's code in the source the KOMBI
// compiles; -1 (the plain export) keeps all five, picked by u_mode.x as before
#if STYLE < 0
#define u_style u_mode.x
#else
#define u_style float(STYLE)
#endif
#define u_hub u_mode.y
#define u_glowK u_mode.z
#define u_box u_mode.w
#define u_value u_dyn.x
#define u_over u_dyn.yz
#define u_hot u_dyn.w
// The over-speed marking's leading "tab" (MEASURED 2026-11-15 off reference/6wb/12, see the u_over blocks below):
// half its angular width, as a fraction of the sweep. 1.5 km/h of the 0..260 scale = 0.0058; the marking is only
// ever drawn on the speed dial (hud.js guards w.measure === 'speed'), whose scale is 0..260 in every 6WB layout.
#define LEADW 0.0058
#define u_hasBase u_fill.z

const float PI = 3.14159265359;

float seg(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h);
}
// a circle line of width w at radius r
float ringAt(float d, float r, float w) { return clamp(w * 0.5 + 0.5 - abs(d - r), 0.0, 1.0); }
// 1 inside the arc from angle a0 over span (radians, clockwise from 12)
float arcIn(float a, float a0, float span) {
    float rel = mod(a - a0 + 4.0 * PI, 2.0 * PI);
    return rel <= span ? 1.0 : 0.0;
}

void main() {
    vec2 p = vec2(v_uv.x - 0.5, 0.5 - v_uv.y) * u_size;   // px from the centre, +y up
    if (u_flip > 0.5) p.x = -p.x;
    float R = min(u_size.x, u_size.y) * 0.5 - 1.0;
    float d = length(p / R) * R;          // not length(p): in fp16 (mediump on the car) x*x + y*y overflows past ~256 px
    if (d > R + 0.5) { gl_FragColor = vec4(0.0); return; }
    float edge = clamp(R + 0.5 - d, 0.0, 1.0);
    float a = atan(p.x, p.y);
    float rel = mod(a - u_start + 4.0 * PI, 2.0 * PI);
    float frac = rel / u_sweep;
    bool inSweep = rel <= u_sweep + 0.012;
    float gapMid = u_sweep + (2.0 * PI - u_sweep) * 0.5;
    float past = rel > gapMid ? 2.0 * PI - rel : rel - u_sweep;      // rad past the nearer end (< 0: inside)
    float open = 1.0 - smoothstep(0.02, 0.10, past);
    float val = clamp(u_value, -u_pre / u_sweep, 1.0);
    float na = u_start + val * u_sweep;
    vec2 nd = vec2(sin(na), cos(na));
    vec2 q = vec2(dot(p, vec2(nd.y, -nd.x)), dot(p, nd));            // across, along the needle
    vec3 glow = u_hot > 0.5 ? mix(u_glow, u_red, 0.75) : u_glow;
    vec3 col = u_face;
    vec4 bs = vec4(0.0);
    if (u_hasBase > 0.5) {
        vec2 bu = (v_uv * u_size - u_baseR.xy) / u_baseR.zw;
        if (bu.x >= 0.0 && bu.y >= 0.0 && bu.x <= 1.0 && bu.y <= 1.0) bs = texture2D(u_base, bu);
    }
    float steps = u_ticks * u_minor;
    float k = floor(frac * steps + 0.5);
    float ta = u_start + k / steps * u_sweep;
    vec2 tdir = vec2(sin(ta), cos(ta));
    bool onTick = k >= 0.0 && k <= steps + 0.01 && inSweep;
    float km = mod(k, u_minor);
    bool major = km < 0.5;
    bool midT = abs(km - u_minor * 0.5) < 0.5;
    bool red = (u_redFrom <= 1.0 && frac >= u_redFrom - 0.001) || frac < u_redTo;
    float pd = -p.y;                                                  // px below the centre

#if STYLE < 0 || STYLE == 0
// fix/colour-daynight: the over-speed marking's own red, the real F30 6WB's (181, 26, 17), not u_red * 0.85
// (217, 36, 36): u_red is the redline's and keeps its colour. A constant, so no uniform; the night look (nightLook
// at the end) recolours it as it did u_red, and the plain dimmer never dimmed a red (dimTheme: greys only).
#define OVER_RED vec3(0.710, 0.102, 0.067)
    if (u_style < 0.5) {
        // ---- Comfort
        float r1 = 0.51 * R, r2 = 0.36 * R, fl = 0.26 * R;
        float rbz = R - u_ringW;
        vec2 nn = p / max(d, 0.001);
        float lit = 0.5 + 0.5 * dot(nn, vec2(-0.6, 0.8));              // 1 on the side facing the light (upper left)
        if (u_hasBase > 2.5) {
            // baked: the whole static dial (face, ticks, red zone, OFF arc, discs, rings, bezel, bottom arc); live on top:
            // the over-speed marking, then the hub and the needle below.
            // Radii MEASURED off the F30 (docs/F30-FONT-SPEC.md 9.2-9.3): the marking lives in the EMPTY RING between
            // the hub and the numerals - hard inner edge 0.521 R, brightest there, fading outward to nothing at
            // 0.663 R, which is where the numeral band begins. It never reaches the numerals or the ticks.
            // Before 2026-11-15 this ran 0.64 R -> 0.80 R and faded the OTHER way (faint inside, strong outside).
            col = mix(u_face, bs.rgb, bs.a);
            if (u_over.x >= 0.0 && inSweep && frac >= u_over.x - LEADW && frac <= u_over.y && d > 0.521 * R) {
                float lead = 1.0 - smoothstep(0.0, LEADW, abs(frac - u_over.x));
                float outR = mix(0.663, 0.795, lead) * R;
                float a = 0.72 * clamp((outR - d) / (outR - 0.54 * R), 0.0, 1.0)
                        + 0.30 * (1.0 - smoothstep(0.0, 0.014 * R, abs(d - 0.530 * R)));
                if (d < outR) col = mix(col, OVER_RED, min(a, 1.0));
            }
        } else {
            // the face: black (the references' lifted dark is their LCD's black level and the camera, not drawn), a faint
            // light toward the middle on the lit side, and the shadow the bezel casts inside it
            col = u_face + vec3(0.020, 0.022, 0.030) * lit * (1.0 - d / R);
            if (d < rbz) col *= 1.0 - 0.7 * exp(-(rbz - d) / (0.032 * R));
            if (u_hasBase > 0.5) col = mix(u_face, bs.rgb, bs.a);                // baked: face, its shadow, groove, hub well
            // the inner discs: convex, lighter on the lit side, with a soft shadow outside the edge
            if (u_hasBase > 1.5) {
                // the inner disc and its floor are baked
            } else if (d < r1) {
                float g = clamp(0.5 + pd / (2.0 * r1), 0.0, 1.0);          // 0 at the top .. 1 at the bottom
                // (the dark fills are the old ones less the face's old lift, 0.026/0.030/0.040: that was LCD black)
                col = vec3(0.012) + vec3(0.012, 0.013, 0.017) * (1.0 - g);
                col += vec3(0.018, 0.020, 0.026) * lit * smoothstep(0.35 * r1, r1, d);
                if (pd > fl) col = vec3(0.020, 0.022, 0.028) * clamp((pd - fl) / (0.25 * R), 0.0, 1.0);
                col = mix(col, vec3(0.20, 0.22, 0.26), clamp(1.2 - abs(pd - fl), 0.0, 1.0) * 0.8);       // the floor's edge
                if (pd < fl) {
                    col = mix(col, vec3(0.15, 0.16, 0.20) * (0.5 + 0.8 * lit), ringAt(d, r2, 1.8));
                    col += vec3(0.035, 0.040, 0.050) * exp(-abs(d - r2) / (0.009 * R)) * (0.25 + 0.75 * lit);
                    col *= 1.0 - 0.32 * exp(-max(d - r2, 0.0) / (0.024 * R)) * (0.4 + 0.6 * (1.0 - lit)) * step(r2, d);
                }
            } else {
                col *= 1.0 - 0.42 * exp(-(d - r1) / (0.03 * R)) * (0.45 + 0.55 * (1.0 - lit));
            }
            col = mix(col, vec3(0.24, 0.26, 0.31) * (0.30 + 0.80 * lit), ringAt(d, r1, 2.0) * 0.9);
            col += vec3(0.07, 0.08, 0.10) * exp(-abs(d - r1) / (0.010 * R)) * (0.25 + 0.75 * lit);          // the tube's glow
            col += vec3(0.035, 0.040, 0.050) * ringAt(d, r1 - 0.013 * R, 1.4) * lit;                           // a lit inner edge
            float to = 0.905 * R;                                         // the ticks' outer end
            // the red zone: a band at the ticks and a soft fill inside it
            if (inSweep && u_redFrom <= 1.0 && frac >= u_redFrom && d > 0.74 * R && d < to) {
                col = mix(col, u_red * 0.9, 0.6 * smoothstep(0.74 * R, 0.88 * R, d));
            }
            if (inSweep && u_redFrom <= 1.0 && frac >= u_redFrom && d > 0.862 * R && d < to) col = u_red;
            // over the limit: a red wedge in the empty ring between the hub and the numerals. The same measured
            // radii as the baked path above; the angular ends are whatever the engine puts in u_over (hud.js).
            if (u_over.x >= 0.0 && inSweep && frac >= u_over.x - LEADW && frac <= u_over.y && d > 0.521 * R) {
                float lead = 1.0 - smoothstep(0.0, LEADW, abs(frac - u_over.x));
                float outR = mix(0.663, 0.795, lead) * R;
                float a = 0.72 * clamp((outR - d) / (outR - 0.54 * R), 0.0, 1.0)
                        + 0.30 * (1.0 - smoothstep(0.0, 0.014 * R, abs(d - 0.530 * R)));
                if (d < outR) col = mix(col, OVER_RED, min(a, 1.0));
            }
            // the tick track: a groove, darker than the face, between two lit rims
            if (u_hasBase < 0.5) {
                float gin = 0.80 * R, gout = 0.915 * R;
                float gv = smoothstep(gin - 1.0, gin + 2.0, d) * smoothstep(gout + 1.0, gout - 2.0, d);
                col *= 1.0 - 0.38 * gv;
                col += vec3(0.060, 0.066, 0.080) * ringAt(d, gin, 1.3) * (0.3 + 0.9 * lit);
                col += vec3(0.050, 0.055, 0.068) * ringAt(d, gout, 1.3) * (0.3 + 0.9 * lit);
            }
            if (onTick) {
                float ti = major ? 0.82 * R : (midT ? 0.85 * R : 0.872 * R);
                float w0 = major ? 0.0075 * R : (midT ? 0.0040 * R : 0.0024 * R);      // half width at the inner end
                float w1 = major ? 0.0135 * R : (midT ? 0.0062 * R : 0.0034 * R);      // and at the outer end: a wedge
                vec2 tperp = vec2(tdir.y, -tdir.x);
                float along = dot(p, tdir), across = abs(dot(p, tperp));
                float t = clamp((along - ti) / (to - ti), 0.0, 1.0);
                float hw = mix(w0, w1, t);
                float cov = clamp(hw + 0.5 - across, 0.0, 1.0) * clamp(along - ti + 0.5, 0.0, 1.0) * clamp(to - along + 0.5, 0.0, 1.0);
                vec3 tc = major || midT ? u_tick : u_tick * 0.62;
                tc = mix(tc, vec3(0.55, 0.85, 1.0), smoothstep(0.62, 1.0, t) * (major ? 0.5 : 0.2));   // a cool fringe at the outer end
                // a soft glow, and for the long ones a blurred light spot just past the outer end
                float dd = max(across - hw, 0.0);
                col += tc * 0.13 * exp(-dd / 2.6) * (1.0 - cov) * step(ti - 2.0, along) * step(along, to + 2.0);
                if (major) col += vec3(0.11, 0.12, 0.14) * exp(-dot(p - tdir * (to + 0.014 * R), p - tdir * (to + 0.014 * R)) / (0.022 * R * 0.022 * R));
                col = mix(col, tc, cov);
            }
            if (u_pre > 0.0) {                                            // the arc back to OFF and its mark
                float back = mod(u_start - a + 4.0 * PI, 2.0 * PI);
                if (back < u_pre) col = mix(col, u_tick * 0.55, ringAt(d, 0.888 * R, 1.5));
                float oa = u_start - u_pre;
                vec2 od = vec2(sin(oa), cos(oa));
                col = mix(col, u_tick, clamp(0.5 - (seg(p, od * 0.862 * R, od * to) - 0.0042 * R), 0.0, 1.0));
            }
        }
        // the bottom arc's live fill (both paths): light its segments from u_fill.x to u_fill.y
        if (u_decoR.z > 0.0) {
            vec2 du = (v_uv * u_size - u_decoR.xy) / u_decoR.zw;
            float ang = mod(a + 2.0 * PI, 2.0 * PI);
            if (du.x >= 0.0 && du.y >= 0.0 && du.x <= 1.0 && du.y <= 1.0 && ang >= min(u_fill.x, u_fill.y) && ang <= max(u_fill.x, u_fill.y)) {
                col = mix(col, u_fillC, texture2D(u_deco, du).a);
            }
        }
        // the hub: a dark well, a thin red ring, a dark middle with two red fans leaking in from the ring
        float hr = 0.135 * R;
        if (u_hasBase < 0.5) col *= 1.0 - 0.5 * smoothstep(hr * 2.4, hr * 1.2, d);
        if (d < hr) {
            float fan = pow(0.5 + 0.5 * cos(2.0 * (a - 0.78)), 3.0) * smoothstep(0.35 * hr, hr, d);
            col = vec3(0.36, 0.035, 0.025) * fan * 0.8;
        }
        col += u_needle * 0.30 * exp(-abs(d - hr) / (0.020 * R));
        col = mix(col, u_needle * (0.62 + 0.40 * lit), ringAt(d, hr, 0.014 * R));
        // the needle: first its shadow on the face, moved down and right, soft
        // ref 05 / 15: a long blade that tapers from the hub (~0.048 R wide) to a fine tip (~0.013 R), its tail a little
        // narrower than at the hub; the tip rounded off over its own half width
        float L = 0.925 * R, T = -0.22 * R;
        float W0 = 0.024 * R, W1 = 0.0065 * R, WT = 0.021 * R;  // half width at the hub, at the tip, at the tail's end
        vec2 ps = p - vec2(0.012 * R, -0.020 * R);
        vec2 qs = vec2(dot(ps, vec2(nd.y, -nd.x)), dot(ps, nd));
        if (qs.y > T && qs.y < L) {
            float hws = qs.y < 0.0 ? mix(W0, WT, qs.y / T) : mix(W0, W1, qs.y / L);
            col *= 1.0 - 0.7 * smoothstep(hws + 0.018 * R, hws - 0.002 * R, abs(qs.x));
        }
        // then the blade, a tube: red edges, a dark seam on the lit side, a broad white core, a warm cap on the tail, a
        // white tip, and a soft red halo that follows the taper
        if (q.y > T - 1.0 && q.y < L + 1.0) {
            float hw = q.y < 0.0 ? mix(W0, WT, q.y / T) : mix(W0, W1, q.y / L);
            float yt = q.y - (L - W1);                                // the rounded tip
            if (yt > 0.0) hw = sqrt(max(W1 * W1 - yt * yt, 0.0));
            float ax = abs(q.x);
            float nx = q.x / max(hw, 0.5);                            // -1 .. 1 across the blade
            float ends = clamp(q.y - T + 0.5, 0.0, 1.0) * clamp(L + 0.5 - q.y, 0.0, 1.0);
            col += u_needle * 0.22 * exp(-max(ax - hw, 0.0) / (0.016 * R)) * ends * smoothstep(L, 0.85 * L, q.y);
            vec3 body = mix(vec3(0.50, 0.05, 0.04), u_needle * vec3(1.0, 0.62, 0.50), smoothstep(1.0, 0.45, abs(nx + 0.10)));
            body *= 1.0 - 0.22 * smoothstep(0.0, 1.0, nx);            // the far side a little darker
            float wide = smoothstep(2.5, 5.0, hw);                    // the seam only where the blade is wide enough
            body *= 1.0 - 0.45 * wide * exp(-pow((nx + 0.62) / 0.11, 2.0));
            body = mix(body, vec3(1.0, 0.95, 0.93), smoothstep(0.50, 0.24, abs(nx + 0.06)) * 0.95);   // the light core (ref 05: ~0.4 of the width)
            body = mix(body, vec3(0.92, 0.66, 0.60), smoothstep(T + 0.030 * R, T + 0.008 * R, q.y) * 0.55);   // the tail's cap, a warm light, not white
            body = mix(body, vec3(1.0), smoothstep(0.955 * L, L, q.y) * 0.85);
            col = mix(col, body, clamp(hw + 0.5 - ax, 0.0, 1.0) * ends);
        }
    } else
#endif
#if STYLE < 0 || STYLE == 1
    if (u_style < 1.5) {
        // ---- Sport
        float rb = u_hub * R, ro = R - 4.0;
        float band = clamp((d - rb) / (ro - rb), 0.0, 1.0);
        if (d < rb) {
            col = glow * 0.16 * smoothstep(rb - 70.0, rb, d) * open;
        } else {
            vec3 base = glow * (0.42 + 0.58 * pow(band, 1.3));
            float lit = frac <= val && past < 0.0 ? 1.0 : 0.0;
            base += vec3(0.16, 0.05, 0.05) * lit * band;
            // radial hairlines at every minor step
            float da = abs(frac * steps - k) / steps * u_sweep * d;               // px from the nearest step line
            base *= 1.0 - 0.38 * clamp(1.2 - da, 0.0, 1.0);
            if (u_redFrom <= 1.0 && frac >= u_redFrom && inSweep) base = mix(base, vec3(1.0, 0.25, 0.2), 0.25);
            col = base * open;
            col = mix(col, vec3(0.0), smoothstep(rb + 6.0, rb, d) * 0.35);
        }
        col = mix(col, mix(glow, vec3(1.0), 0.35), ringAt(d, R - 2.0, 2.6) * open);
        col = mix(col, glow * 0.45, ringAt(d, R - 2.0, 2.0) * (1.0 - open) * 0.6);
        col = mix(col, mix(glow, vec3(1.0), 0.15), ringAt(d, rb, 1.6) * open * 0.8);
        if (q.y > rb - 8.0 && q.y < ro) {
            col += vec3(0.5) * clamp(1.0 - abs(q.x) / 12.0, 0.0, 1.0);
            col = mix(col, u_needle, clamp(2.6 + 0.5 - abs(q.x), 0.0, 1.0));
        }
    } else
#endif
#if STYLE < 0 || STYLE == 2
    if (u_style < 2.5) {
        // ---- Eco Pro
        // 2026-11-14: on 6WB Comfort's G20 geometry (R 335) the px sizes, drawn for the first geometry's R 290, scale
        // with the dial (sk), so the bigger dial keeps its proportions
        float sk = R / 289.0;
        float ri = u_hub * R;
        col = mix(col, u_ring2, ringAt(d, R - 1.5, 2.0) * 0.45);
        col = mix(col, u_ring, ringAt(d, R - 1.5, 2.6 * sk) * open);
        if (d > ri && d < R) col += glow * 0.07 * open;
        col += glow * 0.85 * exp(-abs(d - ri) / (13.0 * sk)) * open;              // the inner arc's glow
        col = mix(col, mix(glow, vec3(1.0), 0.8), ringAt(d, ri, 3.0 * sk) * open);
        if (onTick) {
            float len = (major ? 24.0 : 10.0) * sk, wid = (major ? 2.2 : 0.6) * sk;
            float dd = seg(p, tdir * (R - 4.0 * sk - len), tdir * (R - 4.0 * sk)) - wid;
            col = mix(col, u_tick, clamp(0.5 - dd, 0.0, 1.0));
        }
        col = mix(col, glow, ringAt(d, 0.125 * R, 1.8 * sk));
        float L = R - 20.0 * sk;
        if (q.y > 0.0 && q.y < L) {
            float hw = mix(3.6, 1.4, q.y / L) * sk;
            col += glow * 0.55 * clamp(1.0 - abs(q.x) / (16.0 * sk), 0.0, 1.0);
            col = mix(col, u_needle, clamp(hw + 0.5 - abs(q.x), 0.0, 1.0));
        }
    } else
#endif
#if STYLE < 0 || STYLE == 3
    if (u_style < 3.5) {
        // ---- mini side gauge
        float to = 0.84 * R;
        if (u_hasBase > 0.5) col = mix(vec3(0.0), bs.rgb, bs.a);             // baked: face, bezel, zones, ticks, pictogram
        if (u_hasBase < 0.5 && inSweep && d > 0.745 * R && d < to) {
            if (red) col = u_red;
            else if (frac < u_coldTo) col = vec3(0.16, 0.56, 1.0);
        }
        if (onTick && u_hasBase < 0.5) {
            float ti = major ? 0.66 * R : 0.755 * R;
            float wid = major ? 0.017 * R : 0.008 * R;
            col = mix(col, u_tick, clamp(0.5 - (seg(p, tdir * ti, tdir * to) - wid), 0.0, 1.0));
        }
        float hr = 0.125 * R;
        if (d < hr) col = vec3(0.024, 0.025, 0.025);                             // the cap (old fill less LCD black)
        col = mix(col, u_tick * 0.6, ringAt(d, hr, 1.6));
        // the needle (ref 04: short, light, tapering to a rounded tip), a soft shadow down and right, the edges shaded
        float L = 0.66 * R, T = -0.17 * R, W0 = 0.036 * R, W1 = 0.010 * R;
        vec2 ps = p - vec2(0.020 * R, -0.030 * R);
        vec2 qs = vec2(dot(ps, vec2(nd.y, -nd.x)), dot(ps, nd));
        if (qs.y > T && qs.y < L) {
            float hws = qs.y < 0.0 ? W0 : mix(W0, W1, qs.y / L);
            col *= 1.0 - 0.6 * smoothstep(hws + 0.05 * R, hws, abs(qs.x));
        }
        if (q.y > T - 1.0 && q.y < L + 1.0) {
            float hw = q.y < 0.0 ? W0 : mix(W0, W1, q.y / L);
            float yt = q.y - (L - W1);
            if (yt > 0.0) hw = sqrt(max(W1 * W1 - yt * yt, 0.0));
            float nx = q.x / max(hw, 0.5);
            vec3 body = u_needle * (1.0 - 0.38 * smoothstep(0.35, 1.0, abs(nx + 0.15)));
            body = mix(body, vec3(1.0), smoothstep(0.30, 0.0, abs(nx + 0.15)) * 0.35);
            col = mix(col, body, clamp(hw + 0.5 - abs(q.x), 0.0, 1.0) * clamp(q.y - T + 0.5, 0.0, 1.0) * clamp(L + 0.5 - q.y, 0.0, 1.0));
        }
    } else
#endif
#if STYLE < 0 || STYLE == 4
    {
        // ---- Eco Pro's efficiency dial
        // 2026-11-14: on the G20 geometry this dial sits where BMW draws its black box over any theme (catalogue
        // overlay.black_box, x 1422-1612, y 320-440: out to 0.36 R from our centre). So its middle is plain black: no hub
        // ring, and the needle is a pointer from 0.40 R (soft over its first 0.03 R) that never reaches under the box, so
        // nothing of ours is seen cut by it. Px sizes scale with the dial as the speedo's (sk)
        float sk = R / 289.0;
        float ri = u_hub * R;
        col = mix(col, u_ring2, ringAt(d, R - 1.5, 2.0) * 0.55);
        float top = arcIn(a, -0.80, 2.55);                                        // -46 deg .. 100 deg
        float split = abs(a) < 0.022 ? 0.0 : 1.0;
        if (d > R - 17.0 * sk && d < R - 1.0) col = mix(col, u_ring, top * split);
        float inner = arcIn(a, -1.05, 2.45);
        col += glow * 0.85 * exp(-abs(d - ri) / (13.0 * sk)) * inner;
        col = mix(col, mix(glow, vec3(1.0), 0.8), ringAt(d, ri, 3.0 * sk) * inner);
        float r0 = 0.40 * R, L = R - 22.0 * sk;
        if (d < r0 - 0.03 * R) col = u_face;                                      // under BMW's box: black only
        if (q.y > r0 - 0.03 * R && q.y < L) {
            float hw = mix(3.6, 1.4, q.y / L) * sk;
            float k0 = smoothstep(r0 - 0.03 * R, r0, q.y);                         // the pointer's soft inner end
            col += glow * 0.55 * clamp(1.0 - abs(q.x) / (16.0 * sk), 0.0, 1.0) * k0;
            col = mix(col, u_needle, clamp(hw + 0.5 - abs(q.x), 0.0, 1.0) * k0);
        }
    }
#else
    {}
#endif
    if ((u_style < 0.5 || (u_style > 2.5 && u_style < 3.5)) && !(u_style > 2.5 && u_hasBase > 0.5) && u_hasBase < 2.5) {
        // the glossy bezel: brightest toward the upper left, a second light low on the right
        float rb0 = R - u_ringW;
        if (d > rb0) {
            float prof = 1.0 - abs((d - (rb0 + u_ringW * 0.5)) / (u_ringW * 0.5));
            float h1 = 0.5 + 0.5 * cos(a + 0.75), h2 = 0.5 + 0.5 * cos(a - 2.4);
            float lum = clamp(0.22 + 0.78 * h1 * h1 + 0.30 * pow(h2, 6.0), 0.0, 1.0);
            vec3 ring = mix(u_ring2, u_ring, lum) * (0.50 + 0.50 * prof);
            col = mix(col, ring, clamp(prof * 3.0, 0.0, 1.0));
            float lt = 0.5 + 0.5 * dot(p / max(d, 0.001), vec2(-0.6, 0.8));
            col += u_ring * 0.30 * ringAt(d, R - 1.2, 1.2) * (0.3 + 0.9 * lt);           // a thin bright rim on the outside
            col *= 1.0 - 0.30 * smoothstep(rb0 + 0.25 * u_ringW, rb0 + 0.02 * u_ringW, d); // and a darker band just inside the gloss
        }
    }
    if (u_cut.x > 0.0) {
        // the open bottom: the dial fades out toward the cut (into the collar's black band under it), and a soft window
        // shows BMW's own sign or lamp; closed (3), the round one stays opaque and black where the dial has faded
        vec2 lp = v_uv * u_size;                                                  // layer px, +y down
        float cutK = 1.0 - smoothstep(u_cut.x - u_cut.y, u_cut.x, lp.y);        // the dial's own coverage
        float cutSd = 0.0;                                                        // px outside the window's shape
        if ((u_cut.z > 0.5 && u_cut.z < 1.5) || u_cut.z > 2.5) {
            cutSd = length((lp - u_cutW.xy) / 64.0) * 64.0 - u_cutW.z;            // scaled: fp16-safe
        } else if (u_cut.z > 1.5) {
            vec2 wq = max(u_cutW.xy - lp, lp - u_cutW.zw);
            cutSd = length(max(wq, 0.0) / 64.0) * 64.0 + min(max(wq.x, wq.y), 0.0);
        }
        float cutWin = u_cut.z > 0.5 ? smoothstep(-0.5, u_cut.w + 0.5, cutSd) : 1.0;   // 0 in the window .. 1 past its soft edge
        // car3 G (docs/CAR3-G-REPORT.md): the box window (BMW's check-control "i" / warning symbol in our tacho rim)
        // ends our bezel there: below the window's top, on its side of the dial, the bezel ring is black, so no stub of
        // it is left under the window (photos 36 and 41: "a white arc piece below OFF")
        if (u_cut.z > 1.5 && u_cut.z < 2.5) {
            float below = smoothstep(u_cutW.y - 2.0, u_cutW.y + 2.0, lp.y) * (lp.x < u_size.x * 0.5 ? 1.0 : 0.0);
            col *= 1.0 - below * smoothstep(R - u_ringW - 3.0, R - u_ringW - 1.0, d);
        }
        // car3 G: the open round window (BMW's sign) is tight on the sign's own disc and has a black ring round it out
        // to 8 px past its soft edge, so BMW's bottom line does not show beside the sign (photo 37: "line stubs")
        if (u_cut.z > 0.5 && u_cut.z < 1.5) {
            // 2026-11-14: the ring starts where the window ends (cutWin), not 1 px past its soft edge: in between, low in
            // the dial (its cut fade, cutK ~0.4 at BMW's line, y ~645) the dial was half see-through and BMW's line
            // showed as two short arcs beside the sign (car photo 2026-11-14, "the whiskers")
            // 2026-11-16: 10 px, not 8, so the ring still reaches as far out as it did while the window was 2 px
            // wider (gen_6wb.py SIGN_WIN 42 -> 40): the collar's own black keeps clear of r 46 round the sign and
            // its baked edge is soft, so the ring has to meet it at ~r 51, not stop at 49.
            // strip integration (2026-11-16): 8 px again, fading out by 10. The window is on BMW's measured centre at r
            // 42 now, and below y 596 the strip mask is black round the sign anyway; at 10 / 12 the ring's foot reached
            // y 674.8 - the rear belts' 3 px safety footprint (package ZL: from y 674.25). Now it ends at y 672.8.
            float ring = cutWin * (1.0 - smoothstep(u_cut.w + 8.0, u_cut.w + 10.0, cutSd));
            float ringA = max(cutK * cutWin, ring);
            col *= cutK * cutWin / max(ringA, 0.001);
            cutK = ringA;
            cutWin = 1.0;
        }
        // --- end car3 G ---
        if (u_cut.z > 2.5) {
            // the closed disc: opaque out to 10 px past the window's soft edge, as the open window's black ring (car3 G:
            // the window is tight on the sign now, and the collar keeps off r 46 round it; 2026-11-16: 8 -> 10 px
            // with the window 2 px tighter, so the disc still meets the collar's soft black edge)
            float cutA = max(cutK, 1.0 - smoothstep(u_cut.w + 8.0, u_cut.w + 10.0, cutSd));     // (strip integration: as the ring)
            col *= cutK / max(cutA, 0.001);
            cutK = cutA;
        } else {
            cutK *= cutWin;
        }
        edge *= cutK;
    }
    gl_FragColor = vec4(min(nightLook(col), vec3(1.0)), edge);      // 2026-11-14: the night look (identity by day)
}
`;

const WBBACK = `// The 6WB-style themes' backdrop in one cluster-render "effect" layer (GLSL ES 1.00): opaque black over BMW's own
// gauges, and between the two dials (u_dl, u_dr: centre x, centre y, radius, target px):
//   u_style 0 (Comfort): the middle window, a black panel with chamfered top corners and a lit rim, and in
//     it a floor of light bars that narrows toward its horizon;
//   1 (Sport), 2 (Eco Pro): a "shelf" (a horizon line, a floor fading downward in u_color, a base line); Sport adds
//     a glowing bridge between the dials and two wing lines off their upper inner sides.
// u_sign: a round speed limit sign (white field, red ring); its figure is a text widget on top.
// v_uv (0,0) is the top-left.
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;     // px-scale maths: mediump is fp16 on the car's GPU (x*x+y*y overflows past ~256 px)
#else
precision mediump float;
#endif
varying vec2 v_uv;
uniform vec2 u_size;
uniform vec3 u_color;
uniform vec3 u_dl;
uniform vec3 u_dr;
// 0.7.13: STYLE (prepended by styled(), shaders.wbbackFor) leaves only that look's code; -1: all, by u_style
#if STYLE < 0
uniform float u_style;
#else
#define u_style float(STYLE)
#endif
uniform vec3 u_sign;      // the speed limit sign: centre x, y and radius, target px (radius 0: none)
uniform sampler2D u_t0;   // baked textures (hud/scene): the window and the bar under it, the horizon line, the bar's top line
uniform sampler2D u_t1;
uniform sampler2D u_t2;
uniform vec4 u_r0;        // each one's box, target px: x, y, w, h
uniform vec4 u_r1;
uniform vec4 u_r2;
uniform vec2 u_win;       // the baked window's level (a gain), applied above this y (the bar below keeps its own)
uniform float u_hasTex;   // 1: the baked window, horizon and bar; 2: a collar only (u_t0 over u_r0: black, coverage in
                          // alpha), see-through elsewhere, so BMW's own cluster shows round our dials
uniform vec4 u_hole;      // a see-through window for BMW's own map under us: x, y, w, h (w 0: none)
uniform float u_holeR;    // its corner radius
// Comfort's middle window (package A, docs/POLISH-A-REPORT.md): no hard box. u_wbox is the window, x, y, w, h (w 0:
// none, the old hard hole); u_fade its soft edges in px: top, sides, bottom, and the shade off the dials' rims. The map
// (u_hole on) fades into black toward them as the stock G20's map veil does; the baked floor fades at the sides and rims.
uniform vec4 u_wbox;
uniform vec4 u_fade;
uniform vec4 u_foot;      // the line at the window's foot: style (0 the baked glass line u_t2, 1 hairline, 2 chrome,
                          // 3 none), y, x0, x1
// --- package F (docs/POLISH-F-REPORT.md), the collar path (u_hasTex 2, 6WB Dials + G20) only ---
// u_shade: the shade at our dials' inner edges over BMW's map ("dialShade"): strength at the rim (0: none), falloff px,
// the y span it fades out over; none inside u_shadeKo (x0, y0, x1, y1: BMW's right "i"). (Package F's cover and the
// four black patches u_pat0..3 are gone: package M's strip mask draws that black now.)
uniform vec4 u_shade;
uniform vec4 u_shadeKo;
// BMW's check-control message panel (2026-11-13), the opaque layouts: while the car says a message shows, this
// rounded box (x0, y0, x1, y1, layer px; x1 <= x0: none) is see-through, so BMW's message shows clean. (The collar
// path opens BMW's panel with the strip mask's hole lane instead.)
uniform vec4 u_cc;
// ---- fix/opaque-cc (2026-11-16): BMW's panel OUTLINE, not a box (docs/strip/ZC-REPORT.md, "zc.panel"). u_cc is then
// the outline's bounds (tips x, top, bottom). u_ccS: the arc rail's shoulder circles, left centre x, right centre x,
// centre y, radius (w 0: none, the old rounded box); u_ccE: the sides, x >= L - max(Ly - y, 0) (left: the tip, then
// straight down) and x <= R + max(Ry - y, 0) (right: the slant along the fill's fade), as L, Ly, R, Ry.
uniform vec4 u_ccS;
uniform vec4 u_ccE;
// ---- end fix/opaque-cc ----
// --- end package F ---
// --- package M (docs/strip/M-REPORT.md): the STRIP mask, the collar path only ---
// One baked R8 atlas (u_t2; its size in px in u_r2.zw; tools/strip/bake_mask.py) holds our coverage over BMW's
// bottom strip at full size, one byte a px, one "lane" per state of the row, each in its own tile. u_mk: the box the
// cover lanes share (layer px x0, y0, x1, y1; x1 <= x0: no lane, the collar alone); inside it our black IS the lane,
// outside it the collar draws. u_mh: the hole lane's box (BMW's message panel, its symbol and marker), a multiplier
// applied last (x1 <= x0: none). u_mo: where the cover lane and the hole lane start in the atlas, px (cover x, y,
// hole x, y): one message switches the lane.
uniform vec4 u_mk;
uniform vec4 u_mh;
uniform vec4 u_mo;
// --- end package M ---
${NIGHT_GLSL}

const float PI = 3.14159265359;

// package M: is p in the box b (x0, y0, x1, y1; half-open; x1 <= x0: never)
bool inBox(vec2 p, vec4 b) { return b.z > b.x && p.x >= b.x && p.y >= b.y && p.x < b.z && p.y < b.w; }
// package M: an R8 asset's byte. The car samples R8 as (r, 0, 0, 1); the bench page gets it as (r', r', r', r) with
// r' rounded by its canvas's premultiplied alpha, so .a is read wherever it is not 1 (exact on both, bilinear too)
float r8a(vec4 s) { return s.a < 0.999 ? s.a : s.r; }
// package M: a lane's value at p (its box b, its origin o in the atlas). floor() + 0.5 lands on the texel's centre
// whatever the rounding of p (fp16 would miss by up to 0.94 texel past x 1024: highp, and the snap, docs/strip/
// M-REPORT.md)
float laneAt(vec2 p, vec4 b, vec2 o) { return r8a(texture2D(u_t2, (floor(p - b.xy) + 0.5 + o) / u_r2.zw)); }

// package F: px outside the box b (x0, y0, x1, y1), rounded by r; < 0 inside. fp16-safe: length() of a clamped vector
float boxOut(vec2 p, vec4 b, float r) {
    vec2 q = max(b.xy - p, p - b.zw) + r;
    return length(clamp(q, 0.0, 64.0)) + min(max(q.x, q.y), 0.0) - r;
}

// the line at the window's foot (u_foot), drawn over the map's fade: 1 a hairline fading out at both ends (the 6WB's
// own info bar line), 2 a chrome rod with round caps, shaded as our dial bezels; rgb and its coverage, 0 off it
vec4 footLine(vec2 p) {
    if (!(u_foot.x > 0.5 && u_foot.x < 2.5 && abs(p.y - u_foot.y) < 12.0)) return vec4(0.0);
    float t = (p.x - u_foot.z) / (u_foot.w - u_foot.z), dy = p.y - u_foot.y;
    vec4 L = vec4(0.0);
    if (u_foot.x < 1.5) {
        float env = smoothstep(0.0, 0.30, t) * (1.0 - smoothstep(0.70, 1.0, t));
        float core = clamp(1.4 - abs(dy), 0.0, 1.0), halo = exp(-abs(dy) / 2.4);
        L = vec4(0.80, 0.85, 0.92, env * max(0.95 * core, 0.26 * halo));
    } else {
        // the bezels' profile (a bright lip on top, a dark groove, a dimmer lower ridge), sampled off our dials
        float hh = 4.0, len = u_foot.w - u_foot.z;
        float ax = max(abs(p.x - (u_foot.z + u_foot.w) * 0.5) - (len * 0.5 - hh), 0.0);
        float cov = clamp(hh + 0.5 - length(vec2(min(ax, 16.0), dy) / 16.0) * 16.0, 0.0, 1.0);   // fp16-safe
        float lum = 0.06 + 0.72 * exp(-(dy + 1.8) * (dy + 1.8) / 1.4) + 0.40 * exp(-(dy - 2.2) * (dy - 2.2) / 1.0);
        float spec = 0.70 + 0.30 * exp(-(t - 0.5) * (t - 0.5) / 0.06);         // brightest in the middle
        L = vec4(vec3(0.97, 0.98, 1.0) * lum * spec, cov);
    }
    return L;
}

// the stock map veil's curve (docs/G20SIM-D-live.md, the map): 0 at the edge, 1 at t >= 1, steep at first
float veil(float t) { float u = 1.0 - clamp(t, 0.0, 1.0); return 1.0 - u * u; }

void main() {
    vec2 p = v_uv * u_size;                                                       // px, +y down
    // px outside each dial (scaled before length(): fp16 squares overflow past ~256 px)
    float dl = (length((p - u_dl.xy) / u_dl.z) - 1.0) * u_dl.z, dr = (length((p - u_dr.xy) / u_dr.z) - 1.0) * u_dr.z;
    float between = p.x > u_dl.x && p.x < u_dr.x ? 1.0 : 0.0;
    float out2 = clamp(min(dl, dr) - 4.0, 0.0, 1.0) * between;
    float mid = (u_dl.x + u_dr.x) * 0.5;
    float cy = u_dl.y, R = u_dl.z;
    vec3 col = vec3(0.0);
    if (u_hasTex > 1.5) {
        float a = 0.0;
        if (inBox(p, u_mk)) a = laneAt(p, u_mk, u_mo.xy);            // package M: the strip mask's lane is our black
        else {
            // the collar: pure black (empty space is black), its coverage soft and baked (tools/overlay/plan_dials.py);
            // package M: R8 now (collar_r8: a quarter of the pixel memory), read by r8a()
            vec2 u0 = (p - u_r0.xy) / u_r0.zw;
            a = u0.x >= 0.0 && u0.y >= 0.0 && u0.x <= 1.0 && u0.y <= 1.0 ? r8a(texture2D(u_t0, u0)) : 0.0;
        }
        // --- package F: the shade at our dials' inner edges (laid over the window's veil below) ---
        float sh = 0.0;
        if (u_shade.x > 0.0 && between > 0.5) {
            float o = min(dl, dr);                                   // px outside the nearer dial (scaled lengths above)
            float vy = 1.0 - clamp((p.y - u_shade.z) / max(u_shade.w - u_shade.z, 1.0), 0.0, 1.0);
            sh = u_shade.x * exp(-max(o, 0.0) / u_shade.y) * vy * clamp((o + 3.0) / 3.0, 0.0, 1.0);
            if (u_shadeKo.z > u_shadeKo.x) sh *= smoothstep(0.0, 2.0, boxOut(p, u_shadeKo, 0.0));
        }
        // --- end package F ---
        // car3 G: BMW's map between our dials gets soft edges (docs/CAR3-G-REPORT.md): black beside and above the
        // window u_wbox (x, y, w, h, measured on the car photos 41 and 42), fading to clear over u_fade.y px at its
        // sides and u_fade.x px at its top, as package A's 6WB window does. Only between our dials and outside them
        // (the dials cover the rest), never on the check-control panel (it fades out over the u_fade.z px above the
        // window's foot, which is the panel's top less a margin) nor on BMW's right "i" (u_shadeKo)
        if (u_wbox.z > 0.0 && between > 0.5) {
            float ex = min(p.x - u_wbox.x, u_wbox.x + u_wbox.z - p.x), yb = u_wbox.y + u_wbox.w;
            // 2026-11-14: the very shape of 6WB Comfort's map window (round corners, the foot faded too, shaded off
            // the dials' rims over u_fade.w px). The collar's cover of BMW's stock dials stays off it (its straight
            // edges at x 704 / 1204 squared the top corners), and the black runs 4 px under our rims (no hairline)
            vec2 q = vec2(1.0 - clamp(ex / max(u_fade.y, 1.0), 0.0, 1.0),
                          1.0 - clamp(min((p.y - u_wbox.y) / max(u_fade.x, 1.0), (yb - p.y) / max(u_fade.z, 1.0)), 0.0, 1.0));
            float vis = veil(1.0 - length(q)) * (ex > 0.0 ? 1.0 : 0.0);
            if (u_fade.w > 0.0) vis *= smoothstep(0.0, u_fade.w, min(dl, dr));
            a *= 1.0 - vis;
            float mv = (1.0 - vis) * clamp((min(dl, dr) + 6.0) / 3.0, 0.0, 1.0);
            mv *= 1.0 - smoothstep(yb + 2.0, yb + 4.0, p.y);             // to the info field's top (CC_TOP, y 598)
            if (u_shadeKo.z > u_shadeKo.x) mv *= smoothstep(0.0, 2.0, boxOut(p, u_shadeKo, 0.0));
            a = max(a, mv);
        }
        // --- end car3 G ---
        // 2026-11-16: the shade goes OVER the veil (alpha-over, black on black). It was max()ed in before the veil, whose
        // a *= 1 - vis and max(a, mv) = 1 - vis then overwrote it everywhere: "dialShade" changed nothing. sh 0: a as before
        a += sh * (1.0 - a);
        // 2026-11-14: the window's foot line as in 6WB Comfort ("wbFoot"), over the black foot band
        vec4 L = footLine(p);
        vec3 fc = vec3(0.0);
        if (L.a > 0.0) {
            float a2 = L.a + a * (1.0 - L.a);
            fc = L.rgb * L.a / max(a2, 1e-4);
            a = a2;
        }
        if (inBox(p, u_mh)) a *= laneAt(p, u_mh, u_mo.zw);           // package M: BMW's message panel shows
        gl_FragColor = vec4(min(nightLook(fc), vec3(1.0)), a);       // 2026-11-14: the night look
        return;
    }
    // the soft window (u_wbox): its sides and the dials' rims shade it, its top and bottom fade the map
    float shade = 1.0, vis = 1.0;
    if (u_wbox.z > 0.0) {
        float ex = min(p.x - u_wbox.x, u_wbox.x + u_wbox.z - p.x);
        shade = veil(ex / u_fade.y) * smoothstep(0.0, u_fade.w, min(dl, dr));
        // car3 H: the map's fade rounds its corners (the edges' fade bands meet on circular arcs in fade units, not as
        // a product, which keeps square corners), so it reads as a vignette, not a box. Lengths of values <= 1.42: fp16-safe
        vec2 q = vec2(1.0 - clamp(ex / u_fade.y, 0.0, 1.0),
                      1.0 - clamp(min((p.y - u_wbox.y) / u_fade.x, (u_wbox.y + u_wbox.w - p.y) / u_fade.z), 0.0, 1.0));
        vis = veil(1.0 - length(q)) * smoothstep(0.0, u_fade.w, min(dl, dr)) * (ex > 0.0 ? 1.0 : 0.0);
    }
    bool see = u_hole.z > 0.0 && u_wbox.z > 0.0;   // the map shows: the window and its floor are not drawn
#if STYLE < 0 || STYLE == 0
    if (u_style < 0.5 && u_hasTex > 0.5) {
        // the background: black (BAKE C10's near-black blue and halo were the references' LCD black, not drawn)
        vec2 u0 = (p - u_r0.xy) / u_r0.zw, u1 = (p - u_r1.xy) / u_r1.zw, u2 = (p - u_r2.xy) / u_r2.zw;
        if (!see && u0.x >= 0.0 && u0.y >= 0.0 && u0.x <= 1.0 && u0.y <= 1.0) {
            vec4 t = texture2D(u_t0, u0);
            col = mix(col, t.rgb * (p.y < u_win.y ? u_win.x : 1.0), t.a);
        }
        if (!see && u1.x >= 0.0 && u1.y >= 0.0 && u1.x <= 1.0 && u1.y <= 1.0) {
            vec4 t = texture2D(u_t1, u1);
            col = mix(col, t.rgb * u_win.x, t.a);
        }
        // only darkens: the empty window stays pure black. With no foot line (3) the floor fades out above the foot too
        col *= shade * (u_foot.x > 2.5 && u_wbox.z > 0.0 ? veil((u_wbox.y + u_wbox.w - p.y) / u_fade.z) : 1.0);
        if (u_foot.x < 0.5 && u2.x >= 0.0 && u2.y >= 0.0 && u2.x <= 1.0 && u2.y <= 1.0) {
            vec4 t = texture2D(u_t2, u2);
            col = mix(col, t.rgb * u_win.x, t.a);
        }
    } else if (u_style < 0.5) {
        float xl = u_dl.x + 0.92 * R, xr = u_dr.x - 0.92 * R;     // under the dials' bezels a little, so no gap shows
        float yt = cy - 0.90 * R, yb = cy + 0.92 * R;
        float hwd = (xr - xl) * 0.5, ax = abs(p.x - mid);
        float ch = 0.13 * R;                                                      // the top corners' chamfer
        float dx = hwd - ax, dyt = p.y - yt, dyb = yb - p.y;
        float dch = (dx + dyt - ch) * 0.7071;
        float top = min(dyt, dch);
        float ins = min(min(dx, dyb), top);
        if (ins > 0.0) {
            float t = (p.y - yt) / (yb - yt);
            vec3 w = vec3(0.0);                                       // the panel itself is black (LCD black in the photos)
            // the floor: light bars, thin and close at the horizon, wide at the front
            float yh = cy + 0.20 * R, yf = cy + 0.62 * R;
            float s = (p.y - yh) / (yf - yh);
            if (s > 0.0 && s < 1.0) {
                float fw = mix(0.34, 0.78, s) * R;
                float side = smoothstep(fw, fw * 0.70, ax);
                float z = fract(0.92 / (s + 0.16));
                float bar = smoothstep(0.28, 0.46, z) * (1.0 - smoothstep(0.82, 1.0, z));
                w += vec3(0.60, 0.72, 0.76) * (0.04 + 0.42 * bar) * (0.30 + 0.70 * sin(s * PI)) * side;
            }
            w += vec3(0.30, 0.37, 0.42) * clamp(1.3 - abs(p.y - yh), 0.0, 1.0) * smoothstep(0.36 * R, 0.22 * R, ax);
            col = w * clamp(ins, 0.0, 1.0);
            if (u_wbox.z > 0.0) col *= shade;                          // the soft window: no rims, shaded sides
            else {
                col = mix(col, vec3(0.22, 0.26, 0.33), clamp(1.7 - top, 0.0, 1.0));               // the lit rim
                col = mix(col, vec3(0.10, 0.12, 0.16), clamp(1.4 - min(dx, dyb), 0.0, 1.0) * clamp(top - 1.0, 0.0, 1.0));
            }
        }
    } else
#endif
#if STYLE != 0
    {
        float y0 = cy + 0.47 * R, y1 = cy + 0.94 * R;                                 // horizon, base
        float hw0 = (u_dr.x - u_dl.x) * 0.5;
        if (u_style > 1.5) {
            // 2026-11-14: Eco Pro on 6WB Comfort's G20 geometry: the shelf where Comfort's floor is (its horizon
            // y 457, its foot line y 607, i.e. 0.23 R and 0.678 R below the centres), as wide as the gap between the
            // dials at the horizon, so its slanted sides still show (from the first geometry's full centre-to-centre
            // width they would run under the G20's bigger, closer dials)
            y0 = cy + 0.23 * R; y1 = cy + 0.678 * R;
            hw0 -= sqrt(1.0 - 0.23 * 0.23) * R;
        }
        // 2026-11-14: Sport on 6WB Comfort's geometry: its base at the layout's "footLine" y (Comfort's window foot,
        // the info row below it), the horizon 0.42 R above it
        if (u_style > 0.5 && u_style < 1.5 && u_foot.w > u_foot.z) { y1 = u_foot.y; y0 = y1 - 0.42 * R; }
        // the floor: narrower toward the base
        float t = clamp((p.y - y0) / (y1 - y0), 0.0, 1.0);
        float hwd = hw0 * mix(1.0, 0.62, t);
        float inFloor = p.y >= y0 && p.y <= y1 && abs(p.x - mid) < hwd ? 1.0 : 0.0;
        col += u_color * 0.34 * (1.0 - t) * (1.0 - t) * inFloor * out2;
        col += (u_color * 0.6 + vec3(0.12)) * clamp(1.2 - abs(p.y - y0), 0.0, 1.0) * out2 * 0.8;                 // horizon
        col += vec3(0.42) * clamp(1.3 - abs(p.y - y1), 0.0, 1.0) * (abs(p.x - mid) < hw0 * 0.62 ? 1.0 : 0.0);   // base line
        // the floor's slanted sides
        float sx = abs(abs(p.x - mid) - hwd);
        col += vec3(0.30) * clamp(1.2 - sx, 0.0, 1.0) * (p.y >= y0 && p.y <= y1 ? 1.0 : 0.0) * out2 * t;
        if (u_style > 0.5 && u_style < 1.5) {
            float by = cy + 0.06 * R;
            float g = exp(-(p.y - by) * (p.y - by) / (2.0 * 46.0 * 46.0));
            col += u_color * 0.62 * g * out2;
            // wings: from each dial's upper inner side, curving level toward the middle
            float side = p.x < mid ? 1.0 : -1.0;
            float x0 = p.x < mid ? u_dl.x + 0.80 * R : u_dr.x - 0.80 * R;
            float u = (p.x - x0) * side;                                              // px inward from the wing's root
            if (u > 0.0 && u < 130.0) {
                float wy = cy - 0.66 * R + 46.0 * (1.0 - exp(-u / 45.0));
                float fade = 1.0 - u / 130.0;
                col += vec3(0.9) * clamp(1.4 - abs(p.y - wy), 0.0, 1.0) * fade * out2;
                col += u_color * 0.5 * exp(-abs(p.y - wy) / 9.0) * fade * out2;
            }
        }
    }
#else
    {}
#endif
    if (u_sign.z > 0.0) {
        float ds = length(p - u_sign.xy);
        vec3 sc = ds < u_sign.z * 0.79 ? vec3(0.95, 0.95, 0.94) : vec3(0.84, 0.05, 0.07);
        col = mix(col, sc, clamp(u_sign.z + 0.5 - ds, 0.0, 1.0));
    }
    float alpha = 1.0;
    if (see) {
        // BMW's map shows through the soft window: black over it (the window is not drawn), more of it toward the
        // edges and the dials' rims
        alpha = 1.0 - vis;
        if (p.y < u_wbox.y + u_wbox.w) col = vec3(0.0);           // the glass line below it stays
    } else if (u_hole.z > 0.0) {
        // BMW's map shows through: a rounded box, a soft 1.5 px edge, a thin lit rim round it
        vec2 hc = u_hole.xy + u_hole.zw * 0.5, hq = abs(p - hc) - (u_hole.zw * 0.5 - vec2(u_holeR));
        float sd = length(max(hq, 0.0)) + min(max(hq.x, hq.y), 0.0) - u_holeR;
        alpha = smoothstep(-1.5, 0.5, sd);
        col = mix(col, vec3(0.22, 0.26, 0.33), clamp(1.6 - abs(sd - 1.0), 0.0, 1.0) * 0.8);
    }
    vec4 L = footLine(p);
    if (L.a > 0.0) {
        float a2 = L.a + alpha * (1.0 - L.a);
        col = (L.rgb * L.a + col * alpha * (1.0 - L.a)) / max(a2, 1e-4);
        alpha = a2;
    }
    // ---- fix/opaque-cc: the message panel shows, cut to BMW's own outline (flat top, round shoulders, tips, sides),
    // a 2 px feather outward. sd < 0 inside; the shoulder's offsets are clamped to 128 px (fp16-safe length())
    if (u_cc.z > u_cc.x) {
        float sd = boxOut(p, u_cc, u_ccS.w > 0.0 ? 0.0 : 8.0);
        if (u_ccS.w > 0.0) {
            vec2 q = clamp(vec2(max(u_ccS.x - p.x, p.x - u_ccS.y), u_ccS.z - p.y), 0.0, 128.0);
            sd = max(sd, max(length(q) - u_ccS.w,
                max(u_ccE.x - max(u_ccE.y - p.y, 0.0) - p.x, p.x - u_ccE.z - max(u_ccE.w - p.y, 0.0))));
        }
        alpha *= smoothstep(-0.5, 1.5, sd);
    }
    // ---- end fix/opaque-cc ----
    gl_FragColor = vec4(min(nightLook(col), vec3(1.0)), alpha);  // 2026-11-14: the night look (identity by day)
}
`;

const WBSIGN = `// The 6WB-style road signs in one cluster-render "effect" layer (GLSL ES 1.00), under the speed dial's hub: the
// speed limit sign (its figure is a text widget on top) on the left and the no-overtaking sign on the right.
// u_show.x / u_show.y turn each on (u_show.x 2: the end-of-limit sign instead, drawn here; package E; u_show.x 3: the
// empty sign "---", no limit known; car3 I). Baked (u_tex 1: hud/scene sign_limit / sign_nopass, our own drawings, at
// u_r0 / u_r1 in the layer's px), else drawn here. Not BMW's artwork.
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;     // px-scale maths: mediump is fp16 on the car's GPU (x*x+y*y overflows past ~256 px)
#else
precision mediump float;
#endif
varying vec2 v_uv;
uniform vec2 u_size;
uniform vec2 u_show;
uniform float u_tex;
uniform sampler2D u_s0;
uniform sampler2D u_s1;
uniform vec4 u_r0;
uniform vec4 u_r1;
${NIGHT_GLSL}     // 2026-11-14: at night only dimmed (hud.js "sign"), a road sign keeps its colours

const vec3 RED = vec3(0.84, 0.05, 0.07);

float disc(vec2 p, vec2 c, float r) { return clamp(r + 0.5 - length(p - c), 0.0, 1.0); }
float rbox(vec2 p, vec2 c, vec2 h, float r) {
    vec2 q = abs(p - c) - (h - vec2(r));
    return clamp(0.5 - (length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r), 0.0, 1.0);
}
vec4 tex(sampler2D t, vec4 r, vec2 p) {
    vec2 u = (p - r.xy) / r.zw;
    return u.x >= 0.0 && u.y >= 0.0 && u.x <= 1.0 && u.y <= 1.0 ? texture2D(t, u) : vec4(0.0);
}
// package E: the end-of-limit sign (u_show.x 2): a white disc, a thin grey ring and five diagonal stripes from
// upper right to lower left, in our signs' white. q: px from the centre, R: the disc's radius. No texture of its own.
vec4 endSign(vec2 q, float R) {
    float d = length(q / R) * R;
    float a = clamp(R + 0.5 - d, 0.0, 1.0);
    vec3 s = mix(vec3(0.93), vec3(0.42), clamp(d - (R - 3.0) + 0.5, 0.0, 1.0));
    float t = (q.x + q.y) * 0.70711, per = R * 0.13;
    float k = floor(t / per + 0.5);
    float line = abs(k) <= 2.0 ? clamp(per * 0.24 - abs(t - k * per) + 0.5, 0.0, 1.0) : 0.0;
    s = mix(s, vec3(0.08), line * clamp(R * 0.86 - d + 0.5, 0.0, 1.0));
    return vec4(s, a);
}
// car3 I: the empty sign (u_show.x 3), as BMW shows "no limit known": the limit sign's ring and disc with three short
// dark dashes across its middle in place of the figure (photos g20/40, ours/41: the dashes span 0.4 of the sign, each
// 0.105 of it long). q: px from the centre, R: the sign's outer radius. Coverage of the dashes.
float dashes(vec2 q, float R) {
    float c = 0.0;
    for (int i = -1; i <= 1; i++) c = max(c, rbox(q, vec2(float(i) * 0.295 * R, 0.0), vec2(0.105 * R, 0.042 * R), 0.03 * R));
    return c;
}

void main() {
    vec2 p = v_uv * u_size;
    vec4 col = vec4(0.0);
    if (u_tex > 0.5) {
        if (u_show.x > 2.5) {            // car3 I: "---" on the baked limit sign (its figure is empty)
            vec2 q = p - (u_r0.xy + u_r0.zw * 0.5);
            col = tex(u_s0, u_r0, p);
            col.rgb = mix(col.rgb, vec3(0.12), dashes(q, min(u_r0.z, u_r0.w) * 0.5 - 1.0) * col.a);
        }
        else if (u_show.x > 1.5) col = endSign(p - (u_r0.xy + u_r0.zw * 0.5), min(u_r0.z, u_r0.w) * 0.5 - 1.0);
        else if (u_show.x > 0.5) col = tex(u_s0, u_r0, p);
        if (u_show.y > 0.5) {
            vec4 b = tex(u_s1, u_r1, p);
            col = vec4(mix(col.rgb, b.rgb, b.a), max(col.a, b.a));
        }
        gl_FragColor = vec4(nightLook(col.rgb), col.a);
        return;
    }
    float R = 38.0;
    vec2 c1 = vec2(u_size.x * 0.5 - 48.0, u_size.y * 0.5);
    vec2 c2 = vec2(u_size.x * 0.5 + 48.0, u_size.y * 0.5);
    if (u_show.x > 1.5 && u_show.x < 2.5) col = endSign(p - c1, R);
    else if (u_show.x > 0.5) {
        float a = disc(p, c1, R);
        col = vec4(length(p - c1) < R * 0.79 ? vec3(0.95) : RED, a);
        if (u_show.x > 2.5) col.rgb = mix(col.rgb, vec3(0.12), dashes(p - c1, R));    // car3 I: "---"
    }
    if (u_show.y > 0.5) {
        float a = disc(p, c2, R);
        vec2 q = p - c2;
        vec3 s = length(q) < R * 0.79 ? vec3(0.95) : RED;
        float l = max(rbox(q, vec2(-8.0, 3.0), vec2(11.0, 6.5), 3.0), rbox(q, vec2(-8.0, -5.0), vec2(7.0, 5.0), 3.0));
        float r = max(rbox(q, vec2(8.0, 3.0), vec2(11.0, 6.5), 3.0), rbox(q, vec2(8.0, -5.0), vec2(7.0, 5.0), 3.0));
        float field = clamp(R * 0.79 - length(q) + 0.5, 0.0, 1.0);
        s = mix(s, vec3(0.80, 0.08, 0.10), l * field);
        s = mix(s, vec3(0.06, 0.06, 0.07), r * field);
        s = mix(s, vec3(0.95), rbox(q, vec2(8.0, -3.0), vec2(4.0, 1.4), 0.8) * r * field);
        col = vec4(mix(col.rgb, s, a), max(col.a, a));
    }
    gl_FragColor = vec4(nightLook(col.rgb), col.a);
}
`;

// ---- car3 I: the auto start/stop (MSA) sign --------------------------------------------------------------------------
const WBMSA = `// The 6WB themes' auto start/stop sign in one small cluster-render "effect" layer (GLSL ES 1.00): a capital A inside a
// circular arrow (open at the bottom, its head at the lower left), as BMW's MSA symbol; our own drawing, not BMW's artwork.
// u_msa.x: 0 or 1 hidden (none known / active: the F30 shows nothing while MSA waits), 2 off (deactivated by the button:
// crossed out, u_fg), 3 engine stopped by MSA (u_on, BMW's green; the rev needle rests at READY meanwhile), 4 unavailable
// (the stop conditions are not met: crossed out, u_dim). The layer is square; the symbol fills 0.9 of it.
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;     // px-scale maths: mediump is fp16 on the car's GPU
#else
precision mediump float;
#endif
varying vec2 v_uv;
uniform vec2 u_size;
uniform vec4 u_msa;
uniform vec4 u_fg;
uniform vec4 u_dim;
uniform vec4 u_on;

float seg(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a, ba = b - a;
    return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0));
}
float ink(float d, float w) { return clamp(w - d + 0.5, 0.0, 1.0); }

void main() {
    float st = floor(u_msa.x + 0.5);
    if (st < 1.5 || st > 4.5) { gl_FragColor = vec4(0.0); return; }
    float S = min(u_size.x, u_size.y) * 0.5;
    vec2 q = (v_uv * u_size - u_size * 0.5) / S;      // -1..1, y down
    float px = 1.0 / S, w = 0.065;                     // half a stroke, in S
    // the circular arrow: radius 0.78, open from 140 to 220 degrees (clockwise from the top, i.e. round the bottom)
    float r = length(q), ang = degrees(atan(q.x, -q.y));
    if (ang < 0.0) ang += 360.0;
    float arc = (ang < 140.0 || ang > 220.0) ? ink(abs(r - 0.78) / px, w / px) : 0.0;
    // its head at the gap's left end, pointing along the arc into the gap (down and right)
    vec2 tip = vec2(sin(radians(204.0)), -cos(radians(204.0))) * 0.78;
    vec2 dir = -normalize(vec2(-tip.y, tip.x));        // the anticlockwise tangent at the tip
    vec2 nrm = vec2(-dir.y, dir.x);
    vec2 b = tip - dir * 0.34;
    float head = min(seg(q, tip, b + nrm * 0.25), seg(q, tip, b - nrm * 0.25));
    arc = max(arc, ink(head / px, w / px));
    // the letter A: two legs from the apex and a bar
    float a = min(min(seg(q, vec2(0.0, -0.46), vec2(-0.30, 0.40)), seg(q, vec2(0.0, -0.46), vec2(0.30, 0.40))),
                  seg(q, vec2(-0.17, 0.05), vec2(0.17, 0.05)));
    float c = max(arc, ink(a / px, (w + 0.01) / px));
    vec3 col = st > 2.5 && st < 3.5 ? u_on.rgb : st > 3.5 ? u_dim.rgb : u_fg.rgb;
    if (st > 3.5 || st < 2.5) {
        // crossed out: a stroke from the lower left to the upper right, with a black gap either side
        float d = seg(q, vec2(-0.86, 0.86), vec2(0.86, -0.86));
        c *= 1.0 - ink(d / px, (w + 0.10) / px);
        c = max(c, ink(d / px, w / px));
    }
    gl_FragColor = vec4(col * c, c);
}
`;
// ---- end car3 I ------------------------------------------------------------------------------------------------------

const METER = `// A segmented bar meter for a cluster-render "effect" layer (GLSL ES 1.00): u_segs segments along the layer's
// width (or its height when u_vertical is 1, filling upward), the first u_value of the way lit. A lit segment takes
// u_c1 below u_at.x of the bar, u_c2 up to u_at.y, u_c3 from there (the retro green / amber / red, or warm-up blue /
// white / red); unlit ones u_track. u_peak 0..1 lights the segment it falls in u_peakC (below 0: none). u_gap px
// between segments. v_uv (0,0) is the top-left.
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;     // px-scale maths: mediump is fp16 on the car's GPU (x*x+y*y overflows past ~256 px)
#else
precision mediump float;
#endif
varying vec2 v_uv;
uniform vec2 u_size;
uniform float u_value;
uniform float u_segs;
uniform float u_gap;
uniform float u_vertical;
uniform vec3 u_c1;
uniform vec3 u_c2;
uniform vec3 u_c3;
uniform vec2 u_at;
uniform vec4 u_track;
uniform float u_peak;
uniform vec3 u_peakC;

void main() {
    vec2 p = v_uv * u_size;
    float len = u_vertical > 0.5 ? u_size.y : u_size.x;
    float x = u_vertical > 0.5 ? u_size.y - p.y : p.x;
    float slot = (len + u_gap) / u_segs;
    float i = floor(x / slot);
    float fx = x - i * slot;
    float a = clamp(fx + 0.5, 0.0, 1.0) * clamp(slot - u_gap - fx + 0.5, 0.0, 1.0);
    if (i < 0.0 || i >= u_segs || a <= 0.0) { gl_FragColor = vec4(0.0); return; }
    float f = (i + 0.5) / u_segs;
    vec3 c = f < u_at.x ? u_c1 : (f < u_at.y ? u_c2 : u_c3);
    float lit = (i + 0.5) / u_segs <= u_value + 0.5 / u_segs ? 1.0 : 0.0;
    if (u_value <= 0.0) lit = 0.0;
    if (u_peak >= 0.0 && i == floor(min(u_peak, 0.9999) * u_segs) && lit < 0.5) { gl_FragColor = vec4(u_peakC, a); return; }
    if (lit > 0.5) gl_FragColor = vec4(c, a);
    else gl_FragColor = vec4(u_track.rgb, u_track.a * a);
}
`;

const GMETER = `// A G-meter for a cluster-render "effect" layer (GLSL ES 1.00): a bezel with ticks every 30 degrees, rings every
// u_step g out to u_max (each 0.5 g a little brighter), a crosshair, the grip envelope (the furthest g reached in
// each of 48 directions, as an outline round a faint fill), a fading trail of the last moments, and the dot,
// white, then amber from u_at.x g, then red from u_at.y g (pinned to the bezel past u_max). Positions in g as
// drawn: + x right, + y down (hud.js maps the car's signs). Array uniforms (sent with type vec4):
//   u_trail[i]  two trail points (x, y, x, y), newest first; u_trailN points in use (0..16)
//   u_env[i]    four envelope radii in g, sector k centred on k * 7.5 degrees counter-clockwise from + x
// The loops have constant bounds and the arrays are indexed by the loop counter only, as GLSL ES 1.00 requires.
// The dial fills the smaller side of the layer. v_uv (0,0) is the top-left.
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;     // px-scale maths: mediump is fp16 on the car's GPU (x*x+y*y overflows past ~256 px)
#else
precision mediump float;
#endif
varying vec2 v_uv;
uniform vec2 u_size;
uniform vec2 u_g;
uniform float u_max;
uniform float u_step;
uniform vec4 u_line;
uniform vec3 u_c1;
uniform vec3 u_c2;
uniform vec3 u_c3;
uniform vec2 u_at;
uniform vec3 u_envC;
uniform float u_envOn;
uniform vec4 u_trail[8];
uniform float u_trailN;
uniform vec4 u_env[12];

const float TAU = 6.2831853;

float envAt(float k) {
    float slot = floor(k / 4.0), lane = k - slot * 4.0;
    vec4 v = u_env[0];
    for (int i = 1; i < 12; i++) if (float(i) == slot) v = u_env[i];
    return lane < 0.5 ? v.x : lane < 1.5 ? v.y : lane < 2.5 ? v.z : v.w;
}
vec2 trailAt(float j) {
    float slot = floor(j / 2.0);
    vec4 v = u_trail[0];
    for (int i = 1; i < 8; i++) if (float(i) == slot) v = u_trail[i];
    return j - slot * 2.0 < 0.5 ? v.xy : v.zw;
}
vec3 heat(float g) {
    vec3 c = mix(u_c1, u_c2, smoothstep(u_at.x - 0.1, u_at.x, g));
    return mix(c, u_c3, smoothstep(u_at.y - 0.08, u_at.y, g));
}
vec4 over(vec4 top, vec4 under) {
    float a = top.a + under.a * (1.0 - top.a);
    if (a <= 0.0) return vec4(0.0);
    return vec4((top.rgb * top.a + under.rgb * under.a * (1.0 - top.a)) / a, a);
}

void main() {
    vec2 p = vec2(v_uv.x - 0.5, 0.5 - v_uv.y) * u_size;   // px from the centre, +y up
    float R = min(u_size.x, u_size.y) * 0.5 - 2.0;
    float d = length(p);
    if (d > R + 1.5) { gl_FragColor = vec4(0.0); return; }
    float k = (R - 5.0) / u_max;                           // px per g (the scale ends inside the bezel)
    vec4 col = vec4(0.0);
    // the bezel and its ticks (longer at 12, 3, 6 and 9 o'clock)
    float bez = clamp(1.8 - abs(d - (R - 1.0)), 0.0, 1.0);
    float ang = atan(p.y, p.x);
    float t30 = abs(fract(ang / (TAU / 12.0) + 0.5) - 0.5) * (TAU / 12.0) * d;   // px from the nearest tick line
    float t90 = abs(fract(ang / (TAU / 4.0) + 0.5) - 0.5) * (TAU / 4.0) * d;
    float tick = d > R - 9.0 ? clamp(1.3 - t30, 0.0, 1.0) * 0.8 : 0.0;
    if (d > R - 15.0) tick = max(tick, clamp(1.6 - t90, 0.0, 1.0));
    col = vec4(u_line.rgb, u_line.a * max(bez, tick));
    // rings every u_step g; the 0.5 g ones brighter
    for (int i = 1; i <= 10; i++) {
        float g = float(i) * u_step;
        if (g > u_max - 0.01) break;
        float half_ = abs(fract(g / 0.5 + 0.5) - 0.5) < 0.01 ? 1.0 : 0.0;
        float c = clamp(1.0 - abs(d - g * k), 0.0, 1.0) * (half_ > 0.5 ? 0.7 : 0.38);
        col = max(col, vec4(u_line.rgb, u_line.a * c));
    }
    // the crosshair, with a gap round the centre
    float cx = clamp(1.2 - abs(p.x), 0.0, 1.0), cy = clamp(1.2 - abs(p.y), 0.0, 1.0);
    if (d > 6.0) col = max(col, vec4(u_line.rgb, u_line.a * 0.4 * max(cx, cy)));
    // the grip envelope: radius between the two nearest sectors
    if (u_envOn > 0.5) {
        float f = fract(ang / TAU + 1.0) * 48.0;
        float k0 = floor(f), k1 = k0 + 1.0;
        if (k1 > 47.5) k1 = 0.0;
        float r0 = min(envAt(k0), u_max), r1 = min(envAt(k1), u_max);
        if (r0 > 0.04 || r1 > 0.04) {
            // a direction not reached yet is 0 g, so the outline runs in towards the centre there (a radar
            // chart); the distance is divided by the slope so the steep parts keep their width
            float re = mix(r0, r1, f - k0) * k;
            float slope = (r1 - r0) * k * 48.0 / TAU / max(d, 1.0);
            float dist = abs(d - re) / sqrt(1.0 + slope * slope);
            float edge = clamp(1.4 - dist, 0.0, 1.0) * 0.9;
            float fill = clamp(re - d + 0.5, 0.0, 1.0) * 0.10;
            col = over(vec4(u_envC, max(edge, fill)), col);
        }
    }
    // the trail: fading, thinning segments from the dot back
    float tA = 0.0;
    for (int j = 0; j < 15; j++) {
        float fj = float(j);
        if (fj + 1.0 >= u_trailN) break;
        vec2 a = clamp(trailAt(fj), vec2(-u_max), vec2(u_max)) * vec2(k, -k);
        vec2 b = clamp(trailAt(fj + 1.0), vec2(-u_max), vec2(u_max)) * vec2(k, -k);
        vec2 ab = b - a;
        float h = clamp(dot(p - a, ab) / max(dot(ab, ab), 0.001), 0.0, 1.0);
        float dd = length(p - a - ab * h);
        float age = (fj + h) / 15.0;
        float wdt = mix(3.2, 0.8, age);
        tA = max(tA, clamp(wdt - dd, 0.0, 1.0) * mix(0.85, 0.08, age));
    }
    vec2 g = u_g;
    float gm = length(g);
    if (tA > 0.0) col = over(vec4(heat(gm), tA), col);
    // the dot with a soft glow, pinned to the bezel past u_max
    if (gm > u_max) g = g * (u_max / gm);
    vec2 dp = g * vec2(k, -k);
    float dd = length(p - dp);
    vec3 dc = heat(gm);
    float glow = clamp(1.0 - (dd - 7.0) / 13.0, 0.0, 1.0) * 0.4;
    float dt = clamp(8.0 - dd, 0.0, 1.0);
    col = over(vec4(dc, glow), col);
    col = over(vec4(mix(dc, vec3(1.0), clamp(3.5 - dd, 0.0, 1.0) * 0.6), dt), col);
    gl_FragColor = col;
}
`;

const REVARC = `// A segmented rev arc for a cluster-render "effect" layer (GLSL ES 1.00), the Rally theme's: a band from u_r - u_w
// to u_r round u_center (layer px, y down), from u_start sweeping u_sweep (radians, clockwise from 12 o'clock), in
// u_segs segments, the first u_value of it lit: u_low below u_midAt, u_mid up to u_highAt, u_high past it;
// unlit u_track. u_flash 1: everything lit flashes white (at the redline). v_uv (0,0) is the top-left.
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;     // px-scale maths: mediump is fp16 on the car's GPU (x*x+y*y overflows past ~256 px)
#else
precision mediump float;
#endif
varying vec2 v_uv;
uniform vec2 u_size;
uniform vec2 u_center;
uniform float u_r;
uniform float u_w;
uniform float u_start;
uniform float u_sweep;
uniform float u_segs;
uniform float u_value;
uniform vec3 u_low;
uniform vec3 u_mid;
uniform vec3 u_high;
uniform float u_midAt;
uniform float u_highAt;
uniform vec4 u_track;
uniform float u_flash;

const float PI = 3.14159265359;

void main() {
    vec2 d = v_uv * u_size - u_center;
    float rr = length(d);
    float inner = u_r - u_w;
    float edge = clamp(rr - inner + 0.5, 0.0, 1.0) * clamp(u_r - rr + 0.5, 0.0, 1.0);
    if (edge <= 0.0) { gl_FragColor = vec4(0.0); return; }
    float a = atan(d.x, -d.y);                      // clockwise from 12 o'clock
    float rel = mod(a - u_start + 4.0 * PI, 2.0 * PI);
    if (rel > u_sweep) { gl_FragColor = vec4(0.0); return; }
    float f = rel / u_sweep;
    float slot = u_sweep / u_segs;
    float i = floor(rel / slot);
    float gap = 5.0 / rr;                           // a 5 px gap between segments at this radius
    float fx = rel - i * slot;
    float a1 = clamp((fx) * rr + 0.5, 0.0, 1.0) * clamp((slot - gap - fx) * rr + 0.5, 0.0, 1.0);
    float fc = (i + 0.5) / u_segs;
    vec3 c = fc < u_midAt ? u_low : (fc < u_highAt ? u_mid : u_high);
    bool lit = u_value > 0.0 && fc <= u_value + 0.5 / u_segs;
    if (lit && u_flash > 0.5) c = vec3(1.0);
    if (lit) gl_FragColor = vec4(c, edge * a1);
    else gl_FragColor = vec4(u_track.rgb, u_track.a * edge * a1);
}
`;

const TILES = `// The Dyno theme's tiles in one cluster-render "effect" layer (GLSL ES 1.00): the background u_bg and up to 14
// rounded readout tiles, each filled u_fill (u_warn while its readout is over its warning limit), framed u_line,
// with a thin u_accent strip along the top and an optional bar along the bottom: track u_track, lit from the left
// to the tile's value, coloured by where along the bar it is (u_c1 below u_at.x, u_c2 to u_at.y, u_c3 past it) or
// all u_c1 for a plain bar. Array uniforms (sent with type vec4):
//   u_tile[i]   x, y, w, h in layer px
//   u_tileV[i]  bar value 0..1 (< 0: no bar), warning (0 / 1), zoned bar (0 / 1), unused
//   u_n         tiles in use. u_geo: corner radius, border px, accent strip px, bar height px.
// Colours rgba (fills) or rgb, straight alpha. The loop bound is constant and the arrays are indexed by the loop
// counter only, as GLSL ES 1.00 requires. v_uv (0,0) is the top-left.
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;     // px-scale maths: mediump is fp16 on the car's GPU (x*x+y*y overflows past ~256 px)
#else
precision mediump float;
#endif
varying vec2 v_uv;
uniform vec2 u_size;
uniform vec4 u_bg;
uniform float u_n;
uniform vec4 u_tile[14];
uniform vec4 u_tileV[14];
uniform vec4 u_geo;
uniform vec4 u_fill;
uniform vec4 u_warn;
uniform vec4 u_line;
uniform vec4 u_track;
uniform vec3 u_accent;
uniform vec3 u_c1;
uniform vec3 u_c2;
uniform vec3 u_c3;
uniform vec2 u_at;

float sdBox(vec2 p, vec4 r, float rad) {
    vec2 hs = r.zw * 0.5;
    vec2 q = abs(p - (r.xy + hs)) - (hs - vec2(rad));
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - rad;
}
vec4 over(vec4 top, vec4 under) {
    float a = top.a + under.a * (1.0 - top.a);
    if (a <= 0.0) return vec4(0.0);
    return vec4((top.rgb * top.a + under.rgb * under.a * (1.0 - top.a)) / a, a);
}

void main() {
    vec2 p = v_uv * u_size;
    vec4 c = u_bg;
    for (int i = 0; i < 14; i++) {
        if (float(i) >= u_n) break;
        vec4 b = u_tile[i];
        if (p.x < b.x - 1.0 || p.x > b.x + b.z + 1.0 || p.y < b.y - 1.0 || p.y > b.y + b.w + 1.0) continue;
        vec4 v = u_tileV[i];
        float d = sdBox(p, b, u_geo.x);
        float outer = clamp(0.5 - d, 0.0, 1.0);
        if (outer <= 0.0) continue;
        vec4 col = v.y > 0.5 ? u_warn : u_fill;
        // the accent strip along the top, inside the frame
        if (p.y < b.y + u_geo.z + u_geo.y) col = vec4(v.y > 0.5 ? vec3(1.0) : u_accent, 1.0);
        // the bar: inset 16 px a side, its bottom 12 px over the tile's
        if (v.x >= 0.0) {
            float bx0 = b.x + 16.0, bw = b.z - 32.0, by1 = b.y + b.w - 12.0, by0 = by1 - u_geo.w;
            if (p.x >= bx0 && p.x <= bx0 + bw && p.y >= by0 && p.y <= by1) {
                float f = (p.x - bx0) / bw;
                vec3 lit = v.z > 0.5 ? (f < u_at.x ? u_c1 : (f < u_at.y ? u_c2 : u_c3)) : u_c1;
                if (v.y > 0.5) lit = vec3(1.0);
                col = f <= v.x ? vec4(lit, 1.0) : over(u_track, col);
            }
        }
        float edge = clamp(d + u_geo.y + 0.5, 0.0, 1.0);
        col = mix(col, v.y > 0.5 ? vec4(1.0, 1.0, 1.0, 0.85) : u_line, edge);
        c = over(vec4(col.rgb, col.a * outer), c);
    }
    gl_FragColor = c;
}
`;

const G20DIAL = `// A G20-style gauge for a cluster-render "effect" layer (GLSL ES 1.00): the stock G20 Comfort look, our own drawing
// (tools/bake_g20.py, from the bench simulation, docs/G20SIM-REPORT.md). The static gauge is the baked u_base (it fills
// the layer); live on top: the pointer (a bar from tail to tip, both read for the value from u_lut's entries), its soft
// red-orange glow, and on the rev dial the pink band from 0 to the pointer (u_lut entry 8: per angle about u_C, the
// value there and the band's radius). Minis: a tapered needle, no glow, no band.
// car3 J (photos 39 / 40, docs/CAR3-J-REPORT.md): the glow is the simulation's angular wedge about u_C (sigma in
// degrees by side, a depth window inside the tick ring: u_lut entry 9, the ring's radius per angle); the grey dial
// numerals by the pointer are lit to white and drawn over the bar; the minis' needle is thick at the frame and fades
// at its inner end.
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 v_uv;
uniform vec4 u_box;        // the layer: panel x, y, w, h
uniform sampler2D u_base;  // the static gauge, RGBA straight alpha, the layer's size
uniform sampler2D u_lut;   // 256 x 20, nearest: entry e in rows 2e (x) and 2e + 1 (y), panel px x 16 in R and G
uniform vec4 u_g;          // tip entry, tail entry, kind (0 big dial, 1 mini), the band (1: on)
uniform vec4 u_val;        // the value 0..1; 0; 0; 0
uniform vec2 u_C;          // the rays' centre, panel px
uniform vec4 u_bar;        // width at the tail, at the tip; rim offset, rim width (0: none)
uniform vec3 u_barC;       // the bar's colour
uniform vec3 u_tipC;       // the tip's colour (minis)
uniform vec4 u_rim;        // the rim's colour and alpha (on the low-value side)
uniform float u_rimHi;     // the fainter rim's alpha on the high-value side, at the bar's edge
uniform vec4 u_sh;         // the soft shadow beside the bar on the low-value side: alpha, d0, lambda, dmax px (alpha 0: none)
uniform vec4 u_glow;       // the glow's colour (already scaled) and its sigma on the higher-value side, degrees (0: none)
uniform vec4 u_glow2;      // car3 J: the glow's sigma on the lower-value side (deg), its depth window q0, q1 and its
                           // outer start (px inside the tick ring: none outside it, full 10 px further in)
uniform vec4 u_nl;         // car3 J: the numerals' light: gain, sigma (deg), the depth band (px inside the tick ring) they lie in
uniform vec4 u_bl;         // car3 J: the band line's light by the pointer: sigma higher / lower side (deg), strength; 0
uniform vec4 u_band;       // the band's first and last angle (image atan2, radians), its width px; 0
uniform vec3 u_bandC;
uniform sampler2D u_fill;  // minis: the level's fill (RGB over black) and the mini's area (A); u_base then holds its lines

float dec(vec4 c) { return (c.r * 65280.0 + c.g * 255.0) / 16.0; }
vec2 at(float e, float i) {
    float u = (i + 0.5) / 256.0;
    return vec2(dec(texture2D(u_lut, vec2(u, (2.0 * e + 0.5) / 20.0))), dec(texture2D(u_lut, vec2(u, (2.0 * e + 1.5) / 20.0))));
}
vec2 lutP(float row, float f) {
    float x = clamp(f, 0.0, 1.0) * 255.0, i = floor(x);
    return mix(at(row, i), at(row, min(i + 1.0, 255.0)), x - i);
}
float wrapA(float a) { return mod(a + 3.14159265, 6.2831853) - 3.14159265; }
float angOf(vec2 v) { return atan(v.y, v.x); }

void main() {
    vec2 p = u_box.xy + v_uv * u_box.zw;                                       // panel px
    vec4 bs = texture2D(u_base, v_uv);
    vec3 col = bs.rgb;
    float alpha = bs.a;
    float f = u_val.x;
    vec2 tip = lutP(u_g.x, f), tail = lutP(u_g.y, f);
    // the bar: distance to the segment and how far along it (in 1/64 px units first: fp16-safe)
    vec2 pa = (p - tail) / 64.0, ba = (tip - tail) / 64.0;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
    float dist = length(pa - ba * h) * 64.0;
    vec2 tLo = lutP(u_g.x, max(f - 0.01, 0.0)), tHi = lutP(u_g.x, min(f + 0.01, 1.0));
    float numM = 0.0;
    if (u_g.z > 0.5) {
        // a mini: black over its area, the fill from 0 up to the needle (the side of the needle's line where the 0
        // end lies), then its lines
        vec4 fl = texture2D(u_fill, v_uv);
        vec2 z0 = (lutP(u_g.x, 0.0) - tail) / 64.0;
        float side = sign(ba.x * pa.y - ba.y * pa.x) * sign(ba.x * z0.y - ba.y * z0.x);
        col = fl.rgb * step(0.0, side) * step(0.004, f);
        col = mix(col, bs.rgb, bs.a);
        alpha = max(fl.a, bs.a);
    } else {
        // car3 J: the angle from the pointer about u_C (degrees, + toward higher values) and the depth inside the
        // tick ring (u_lut entry 9: the ring's radius per image angle, speedo in x, tacho in y)
        vec2 q = p - u_C;
        float th = angOf(q);
        float sH = sign(wrapA(angOf(tHi - u_C) - angOf(tLo - u_C)));
        float phi = wrapA(th - angOf(tip - u_C)) * 57.29578 * sH;
        float xr = (th + 3.14159265) / 6.2831853 * 256.0 - 0.5, ir = floor(xr);
        vec2 rr = mix(at(9.0, mod(ir, 256.0)), at(9.0, mod(ir + 1.0, 256.0)), xr - ir);
        float qd = (u_g.w > 0.5 ? rr.y : rr.x) - length(q / 64.0) * 64.0;
        // car3 J: the grey numerals (and km/h) by the pointer are lit to white, and lie over it (39, 40)
        float L = dot(bs.rgb, vec3(0.3333)), sat = max(bs.r, max(bs.g, bs.b)) - min(bs.r, min(bs.g, bs.b));
        numM = smoothstep(0.30, 0.42, L) * (1.0 - smoothstep(0.78, 0.86, L)) * (1.0 - smoothstep(0.10, 0.18, sat))
             * step(u_nl.z, qd) * step(qd, u_nl.w) * bs.a;
        col *= 1.0 + u_nl.x * numM * exp(-phi * phi / (2.0 * u_nl.y * u_nl.y + 1e-3));
        // car3 J: the red band line by the pointer is lit pink-white (39: 225-251, 134-175, 120-149 there, against
        // 120-141, 56-83, 56-79 away from it)
        float bandM = smoothstep(0.30, 0.42, bs.r - max(bs.g, bs.b)) * smoothstep(0.45, 0.6, bs.r)
                    * step(15.0, qd) * step(qd, 80.0) * bs.a;
        float sb = phi > 0.0 ? u_bl.x : u_bl.y;
        col = mix(col, vec3(0.97, 0.67, 0.56), bandM * u_bl.z * exp(-phi * phi / (2.0 * sb * sb + 1e-3)));
        if (u_g.w > 0.5) {
            // the rev band: inside the ticks, from 0 to the pointer
            float j = (th - u_band.x) / (u_band.y - u_band.x);
            if (j >= 0.0 && j <= 1.0) {
                float x = j * 255.0, i = floor(x);
                vec2 b = mix(at(8.0, i), at(8.0, min(i + 1.0, 255.0)), x - i);
                float vAt = b.x / 4095.0, rB = b.y;
                float d = length(q / 64.0) * 64.0;
                float cov = clamp(u_band.z * 0.5 + 0.5 - abs(d - rB), 0.0, 1.0) * clamp((f - vAt) * 400.0, 0.0, 1.0);
                col = mix(col, u_bandC, cov);
            }
        }
        if (u_glow.w > 0.0) {
            // car3 J: the simulation's glow (bench/g20/live drawGlow): a gaussian in angle (sigma by side), full from
            // the band in to q0, a smoothstep to 0 at q1; none over the ticks (39, 40: dark between the band and them)
            float sg = phi > 0.0 ? u_glow.w : u_glow2.x;
            float tq = clamp((qd - u_glow2.y) / max(u_glow2.z - u_glow2.y, 1.0), 0.0, 1.0);
            float wq = (1.0 - tq * tq * (3.0 - 2.0 * tq)) * smoothstep(u_glow2.w, u_glow2.w + 10.0, qd);
            col += u_glow.rgb * exp(-phi * phi / (2.0 * sg * sg)) * wq * alpha;
        }
    }
    float hw = mix(u_bar.x, u_bar.y, h) * 0.5;
    // which side of the bar is the low-value one: where the tip lies at a slightly lower value (bench/g20 live.js drawBar)
    vec2 lo = (tLo - tHi) / 64.0;
    float sgnLo = sign(ba.x * lo.y - ba.y * lo.x);
    float bl = max(length(ba), 1e-4);
    float sd = (ba.x * pa.y - ba.y * pa.x) / bl * 64.0 * sgnLo;            // px across the axis, + toward lower values
    if (u_g.z < 0.5) {
        float hu = dot(pa, ba) / max(dot(ba, ba), 1e-6);                     // along, unclamped (0 tail, 1 tip)
        float along = smoothstep(-0.015, 0.02, hu) * smoothstep(1.015, 0.98, hu);
        if (u_sh.x > 0.0 && sd > 0.0 && sd < u_sh.w) {
            float a = sd <= u_sh.y ? u_sh.x : u_sh.x * exp(-(sd - u_sh.y) / u_sh.z);
            col *= 1.0 - a * along * smoothstep(u_sh.w, u_sh.w * 0.7, sd);
        }
        if (u_bar.w > 0.0) {
            // thin dark lines along the core: at the rim offset on the low side, fainter just past the edge on the high side
            float rl = clamp(u_bar.w * 0.5 + 0.5 - abs(sd - u_bar.z), 0.0, 1.0) * u_rim.a;
            float rh = clamp(u_bar.w * 0.5 + 0.5 - abs(-sd - (hw + u_bar.w * 0.5 + 0.5)), 0.0, 1.0) * u_rimHi;
            col = mix(col, u_rim.rgb, max(rl, rh) * step(hw, dist) * along);
        }
    }
    float cov = clamp(hw + 0.5 - dist, 0.0, 1.0) * (1.0 - numM);
    // minis (car3 J, 40): the frame end's colour, dimming to u_tipC and fading out toward the inner end (h 0)
    float inner = smoothstep(0.0, 0.3, h);
    vec3 bar = u_g.z > 0.5 ? mix(u_tipC, u_barC, inner) : u_barC;
    if (u_g.z > 0.5) cov *= inner;
    col = mix(col, bar, cov);
    alpha = max(alpha, cov);
    gl_FragColor = vec4(min(col, vec3(1.0)), alpha);
}
`;

/** 0.7.13: a 6WB shader with only one look's code in it (STYLE, hud.js WB_STYLE: 0 Comfort .. 4 the efficiency dial),
 *  style -1 keeps every look. The KOMBI compiles a whole shader, every branch: with all five looks in one source a 6WB
 *  layout made it reset (0.7.11, 0.7.12; 0.7.10's sources were ~5 % shorter and drew). So the inactive looks are cut
 *  out here, before the source leaves the app (the "#if STYLE" blocks, evaluated in JS), and so are the comments and
 *  blank lines: the KOMBI gets a much shorter source with nothing in it to skip. */
function styled(src, style, night) {
    const n = Number.isInteger(style) && style >= 0 && style <= 4 ? style : -1;
    return compact('#define STYLE ' + n + '\n' + src, n, night);     // 2026-11-16: night false: no night look (NIGHT_GLSL)
}

/** A shader source with its "#if STYLE ..." blocks resolved for STYLE n (other directives kept as they are), then
 *  without comments, trailing spaces and blank lines. GLSL ES 1.00 has no strings, so "//" always starts a comment. */
function compact(src, n, night) {
    const nk = night === false ? 0 : 1;  // 2026-11-16: NIGHT (NIGHT_GLSL); on unless false, so every other caller is as before
    const out = [], stack = [];          // per open #if: { mine: a STYLE block, take: its branch is kept, done: one was }
    const on = () => stack.every((f) => !f.mine || f.take);
    const cond = (e) => {
        const x = e.replace(/\bSTYLE\b/g, '(' + n + ')').replace(/\bNIGHT\b/g, '(' + nk + ')');      // 2026-11-16: NIGHT
        if (!/^[\d\s()<>=!|&-]+$/.test(x)) throw new Error('shaders.compact: cannot evaluate #if ' + e);
        return !!Function('return (' + x + ');')();       // only digits and operators reach here
    };
    src.split('\n').forEach((line) => {
        const t = line.trim();
        let m;
        if ((m = /^#if\s+(.*\b(?:STYLE|NIGHT)\b.*)$/.exec(t))) {      // 2026-11-16: NIGHT too
            const take = cond(m[1]);
            stack.push({ mine: true, take, done: take });
            return;
        }
        if (/^#if/.test(t)) { stack.push({ mine: false }); if (on()) out.push(line); return; }
        if (/^#else\b/.test(t) && stack.length && stack[stack.length - 1].mine) {
            const f = stack[stack.length - 1]; f.take = !f.done; f.done = true;
            return;
        }
        if (/^#endif\b/.test(t) && stack.length) {
            const f = stack.pop();
            if (!f.mine && on()) out.push(line);
            return;
        }
        if (!on()) return;
        const c = line.replace(/\/\/.*$/, '').replace(/\s+$/, '');
        if (c.trim()) out.push(c);
    });
    if (stack.length) throw new Error('shaders.compact: an #if without #endif');
    // 2026-11-16: NIGHT 0: nightLook(x) is gone from the source, so each call becomes its plain argument
    const res = nk ? out.join('\n') + '\n' : out.join('\n').replace(/\bnightLook\(([\w.]+)\)/g, '$1') + '\n';
    if (!nk && /\bnightLook\b|\bu_nk\d/.test(res)) throw new Error('shaders.compact: a night look left in a NIGHT 0 source');
    return res;
}

module.exports = { wbdialFor: (style, night) => styled(WBDIAL, style, night), wbbackFor: (style, night) => styled(WBBACK, style, night), wbsignFor: (night) => compact(WBSIGN, -1, night) /* 2026-11-16: night false: none (6WB Sport / Eco Pro) */, shiftbar: SHIFTBAR, arc: ARC, revbar: REVBAR, lights: LIGHTS, fill: FILL, box: BOX, grid: GRID, segbar: SEGBAR, mdash: MDASH, mtach: MTACH, sdash: SDASH, boxes: BOXES, atext: ATEXT, dial: DIAL, wbdial: styled(WBDIAL, -1), wbback: styled(WBBACK, -1), wbsign: compact(WBSIGN, -1), wbmsa: compact(WBMSA, -1) /* car3 I */, meter: METER, gmeter: GMETER, revarc: REVARC, tiles: TILES, g20dial: G20DIAL };
