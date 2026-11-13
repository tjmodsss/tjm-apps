'use strict';
/**
 * color.js - the colour wheel's maths. A colour is { h, s }: hue in degrees (0 = red at 12 o'clock,
 * clockwise, as the kit draws arcs) and saturation 0..1 (0 = white in the middle, 1 = the rim).
 * RGB values are [r, g, b], 0..255. A frame is { upper: RGB, lower: RGB, brightness: 0..1 }.
 */
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

/** Hue (degrees), saturation and value (0..1) -> [r, g, b]. */
function hsvToRgb(h, s, v) {
    h = ((h % 360) + 360) % 360; s = clamp(s, 0, 1); v = clamp(v, 0, 1);
    const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
    const p = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return p.map((k) => Math.round((k + m) * 255));
}
const toRgb = (col) => hsvToRgb(col.h, col.s, 1);

/** Point (dx, dy from the wheel's centre, y down) on a wheel of radius r -> colour; null well outside it. */
function fromPoint(dx, dy, r) {
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > r * 1.08) return null;
    return { h: (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360, s: clamp(d / r, 0, 1) };
}
/** Colour -> [dx, dy] from the centre of a wheel of radius r. */
function toPoint(col, r) {
    const a = col.h * Math.PI / 180;
    return [Math.sin(a) * col.s * r, -Math.cos(a) * col.s * r];
}
const mixRgb = (a, b, f) => a.map((c, i) => Math.round(c + (b[i] - c) * clamp(f, 0, 1)));

/** Walk a toward b along the short arc of the wheel. Opposite hues pass the colours between them. */
function lerpColor(a, b, f) {
    f = clamp(f, 0, 1);
    const d = ((b.h - a.h + 540) % 360) - 180;
    return { h: ((a.h + d * f) % 360 + 360) % 360, s: a.s + (b.s - a.s) * f };
}
const scale = (rgb, k) => rgb.map((c) => Math.round(c * clamp(k, 0, 1)));

/** The frame as a backend gets it: channels at most 0xFE (the BDC's colour data), brightness folded in unless caps.brightness. */
function toWire(frame, caps) {
    const fold = !(caps && caps.brightness);
    const out = (rgb) => (fold ? scale(rgb, frame.brightness) : rgb).map((c) => Math.min(254, c));
    return { upper: out(frame.upper), lower: out(frame.lower), brightness: fold ? 1 : frame.brightness };
}

module.exports = { clamp, hsvToRgb, toRgb, fromPoint, toPoint, mixRgb, lerpColor, scale, toWire };
