'use strict';
/**
 * ui_parts.js - controls the pages share: a pill button and a slider. Both are drawn in every mode and
 * reach touch and the controller through cv.target (opts.drag / opts.turn: kit/runtime/record.js).
 */
const { withAlpha } = require('./kit/canvas');

const TEXT = { font: 'bold', spacing: 1.5 };

/** Width a pill needs for label at height h. */
function pillWidth(cv, label, h) { return Math.max(h * 3, cv.textWidth(String(label).toUpperCase(), h * 0.4, TEXT) + h * 1.2); }

/** Pill button run by a tap or a press. o: { key (default: label), on (lit), off (dimmed, nothing to press), turn }. Returns w. */
function pill(cv, t, x, y, w, h, label, run, o) {
    o = o || {};
    const S = t.sel || t.accent;
    cv.roundRect(x, y, w, h, h / 2, o.on ? withAlpha(S, 0.85) : withAlpha('#ffffff', 0.07));
    if (!o.on) cv.strokeRoundRect(x, y, w, h, h / 2, 1.5, withAlpha('#ffffff', o.off ? 0.12 : 0.3));
    cv.text(String(label).toUpperCase(), x + w / 2, y + h / 2 + h * 0.15, h * 0.4, o.off ? t.dim : o.on ? '#ffffff' : t.text,
        { align: 'center', font: 'bold', spacing: 1.5 });
    if (run && !o.off) cv.target(x, y, w, h, run, o.key || label, h / 2, o.turn ? { turn: o.turn } : null);
    return w;
}

/** Slider for a value 0..1 (get / set): label left, track right; follows the finger, the knob moves it step per notch. */
function slider(cv, t, x, y, w, label, get, set, step, key) {
    const tx = x + 220, tw = w - 260, v = get();
    cv.text(String(label).toUpperCase(), x + 24, y + 8, 20, t.dim, TEXT);
    cv.roundRect(tx, y - 6, tw, 12, 6, t.track);
    cv.roundRect(tx, y - 6, Math.max(12, tw * v), 12, 6, t.sel || t.accent);
    cv.circle(tx + tw * v, y, 16, '#ffffff');
    cv.target(tx - 24, y - 28, tw + 48, 56, () => null, key, 12, {
        drag: (phase, px) => set((px - tx) / tw),
        turn: (d) => set(get() + d * step),
    });
}

module.exports = { pill, pillWidth, slider };
