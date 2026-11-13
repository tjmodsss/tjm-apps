'use strict';
/**
 * ui_effects.js - the Effekte page: one tile per effect (a tap starts it; one without data is greyed
 * out with the reason) and a bar along the bottom with Aus and the running effect's settings.
 */
const { withAlpha } = require('./kit/canvas');
const fx = require('./fx');
const { pill, pillWidth } = require('./ui_parts');

const TW = 380, TH = 150, GAP = 12, X0 = 24, Y0 = 56, BAR_Y = 392;

function tile(cv, t, x, y, a, on, act) {
    const e = a.e, S = t.sel || t.accent, n = e.swatch.length;
    cv.roundRect(x, y, TW, TH, 14, on ? withAlpha(S, 0.22) : withAlpha('#ffffff', a.why ? 0.02 : 0.05));
    cv.strokeRoundRect(x, y, TW, TH, 14, on ? 3 : 1.5, on ? S : withAlpha('#ffffff', a.why ? 0.08 : 0.2));
    cv.gradientRect(x + 24, y + 24, 140, 36, e.swatch.map((c, i) => [n > 1 ? i / (n - 1) : 0, a.why ? withAlpha(c, 0.3) : c]));
    cv.text(e.name, x + 24, y + 102, 30, a.why ? t.dim : t.text, { font: 'bold' });
    cv.text(a.why || (on ? 'Läuft' : ''), x + 24, y + 134, 20, a.why ? t.dim : S, { font: 'bold' });
    if (!a.why) cv.target(x, y, TW, TH, () => act.startEffect(e.id), 'fx-' + e.id, 14);
}

function draw(cv, t, m, act) {
    const active = fx.byId[m.st.effect] ? m.st.effect : null;
    m.avail.forEach((a, i) => tile(cv, t, X0 + (i % 4) * (TW + GAP), Y0 + Math.floor(i / 4) * (TH + GAP), a, a.e.id === active, act));
    cv.roundRect(X0, BAR_Y, 4 * TW + 3 * GAP, 108, 14, withAlpha('#ffffff', 0.04));
    let x = X0 + 24;
    x += pill(cv, t, x, BAR_Y + 30, 140, 48, 'Aus', () => act.stopEffect(), { off: !active, key: 'fx-off' }) + 24;
    const e = active ? fx.byId[active] : null;
    if (!e) { cv.text('Kein Effekt aktiv', x, BAR_Y + 62, 22, t.dim); return; }
    const vals = m.params(e);
    e.params.forEach((p) => {
        const label = p.label + ': ' + fx.formatParam(p, vals[p.key]);
        x += pill(cv, t, x, BAR_Y + 30, pillWidth(cv, label, 48), 48, label, () => act.stepParam(e, p, 1, true),
            { key: 'p-' + p.key, turn: (d) => act.stepParam(e, p, d, false) }) + 16;
    });
}

module.exports = { title: 'Effekte', draw };
