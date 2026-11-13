'use strict';
/**
 * ui.js - the centre screen (1600 x 520): five settings pages under header tabs (Home, Panels, Look, Safety, About), drawn
 * from pages.js with the kit's own parts (G.frame tabs, G.button pills, cv.target rows), in Shift Lights 0.4.0's look
 * (apps/adam_shiftlights/ui.js). The kit draws the controller's focus ring and runs a press. Where the kit does not
 * run the screen there are no page buttons: a read-only Home, and the bar's Settings button opens the HMI's list.
 *
 * Drawn only on a change (main.js), never per frame. Only roundRect, circle, text and fillRect (the GPU Recorder and
 * the software Canvas both have them; KB-ANY-198). ASCII text only.
 */
const { withAlpha } = require('./kit/canvas');
const G = require('./kit/gauges');
const P = require('./pages');

const X0 = 40, W = 1520, NOTE_Y = 76, ROW_Y = 92, ROW_H = 62, PITCH = 70, CTL_H = 44;
const PILL_OPT = { font: 'bold', spacing: 1.5 };
const VAL_W = 300, STEP_W = CTL_H + 8 + VAL_W + 8 + CTL_H;

const toneOf = (t, tone) => (tone === 'warn' ? t.warn : tone === 'crit' ? t.crit : tone === 'on' ? t.text : t.dim);
const txt = (cv, s, x, y, size, c, o) => cv.text(String(s), x, y, size, c, Object.assign({ literal: true }, o));

function sw(cv, t, x, y, w, h, on, enabled) {
    const S = t.sel || t.accent;
    cv.roundRect(x, y, w, h, h / 2, on ? withAlpha(S, enabled ? 1 : 0.35) : withAlpha('#ffffff', enabled ? 0.16 : 0.08));
    cv.circle(on ? x + w - h / 2 : x + h / 2, y + h / 2, h / 2 - 5, withAlpha('#ffffff', enabled ? 1 : 0.4));
}
function pillWidths(cv, texts) {
    return texts.map((s) => Math.max(104, Math.ceil(cv.textWidth(String(s).toUpperCase(), CTL_H * 0.4, PILL_OPT)) + 40));
}
function stepper(cv, t, controls, value, x, y, enabled, act, greyed) {
    const btn = (c, bx) => {
        G.button(cv, t, bx, y, CTL_H, CTL_H, ' ', act(c.writes), { key: c.key, busy: !enabled, color: c.end && enabled ? t.dim : undefined });
        const col = enabled && !c.end ? t.text : withAlpha(t.dim, 0.7), cx = bx + CTL_H / 2, cy = y + CTL_H / 2;
        cv.fillRect(cx - 8, cy - 1.5, 16, 3, col);
        if (c.text === '+') cv.fillRect(cx - 1.5, cy - 8, 3, 16, col);
    };
    if (enabled) btn(controls[0], x);
    cv.roundRect(x + CTL_H + 8, y, VAL_W, CTL_H, 10, withAlpha('#ffffff', 0.04));
    txt(cv, value, x + CTL_H + 8 + VAL_W / 2, y + CTL_H / 2 + 8, 22, enabled && !greyed ? t.text : t.dim, { align: 'center', font: 'bold' });
    if (enabled) btn(controls[1], x + CTL_H + 8 + VAL_W + 8);
}
function control(cv, t, r, xr, cy, act) {
    const y = cy - CTL_H / 2;
    if (r.kind === 'toggle') { sw(cv, t, xr - 76, cy - 19, 76, 38, r.controls[0].on, r.enabled); return; }
    if (!cv.own) { txt(cv, r.value, xr, cy + 8, 22, r.enabled ? t.text : t.dim, { align: 'right', font: 'bold' }); return; }
    if (r.kind === 'pills') {
        const ws = pillWidths(cv, r.controls.map((c) => c.text)), gap = 10;
        let x = xr - ws.reduce((a, b) => a + b + gap, -gap);
        r.controls.forEach((c, i) => { G.button(cv, t, x, y, ws[i], CTL_H, c.text, act(c.writes, c.action), { key: c.key, primary: c.on, busy: !r.enabled }); x += ws[i] + gap; });
        return;
    }
    stepper(cv, t, r.controls, r.value, xr - STEP_W, y, r.enabled, act, r.greyed);
}
function drawRow(cv, t, r, x, y, w, act) {
    cv.roundRect(x, y, w, ROW_H, 14, withAlpha('#ffffff', 0.05));
    txt(cv, r.label, x + 24, y + 28, 24, r.enabled ? t.text : t.dim);
    txt(cv, r.desc, x + 24, y + 51, 18, r.greyed ? t.warn : toneOf(t, r.tone));
    control(cv, t, r, x + w - 18, y + ROW_H / 2, act);
    if (r.kind === 'toggle' && r.enabled && cv.own) cv.target(x, y, w, ROW_H, act(r.controls[0].writes), r.controls[0].key, 14);
}
function noteLine(cv, t, v) { if (v.note) txt(cv, v.note, X0 + 4, NOTE_Y, 22, toneOf(t, v.noteTone), { font: 'bold' }); }

function homePage(cv, t, v, act, own) {
    const S = t.sel || t.accent, top = own ? 52 : 48, ch = 200, c = v.card;
    cv.roundRect(X0, top, W, ch, 18, withAlpha('#ffffff', 0.05));
    cv.roundRect(X0, top, 8, ch, 4, c.on ? S : withAlpha('#ffffff', 0.15));
    txt(cv, c.label, X0 + 40, top + 52, 28, t.text, { font: 'bold' });
    txt(cv, c.on ? 'ON' : 'OFF', X0 + 38, top + 136, 72, c.on ? t.text : t.dim, { font: 'bold', spacing: 2 });
    txt(cv, c.on ? c.state.text : own ? 'Press to cover the cluster with the M Track view' : '', X0 + 40, top + 180, 22, toneOf(t, c.state.tone), { font: 'bold' });
    sw(cv, t, X0 + W - 40 - 140, top + ch / 2 - 35, 140, 70, c.on, true);
    if (own) cv.target(X0, top, W, ch, act(c.controls[0].writes), c.controls[0].key, 18);
    const ry = top + ch + 16;
    drawRow(cv, t, v.rows[0], X0, ry, W, act);
    const sy = ry + ROW_H + 16, s = v.status;
    cv.roundRect(X0, sy, W, ROW_H + 8, 14, withAlpha('#ffffff', 0.05));
    if (s.tone === 'warn' || s.tone === 'crit') cv.roundRect(X0, sy, 8, ROW_H + 8, 4, s.tone === 'crit' ? t.crit : t.warn);
    txt(cv, s.line, X0 + 24, sy + 30, 22, toneOf(t, s.tone), { font: 'bold' });
    txt(cv, s.signals, X0 + 24, sy + 56, 18, t.dim);
    txt(cv, own ? 'Every guard: Safety tab' : 'Buttons: Cover on/off, Settings', X0 + W - 18, sy + 56, 18, t.dim, { align: 'right' });
}
function rowsPage(cv, t, v, act) {
    noteLine(cv, t, v);
    v.rows.forEach((r, i) => drawRow(cv, t, r, X0, ROW_Y + i * PITCH, W, act));
}
function aboutPage(cv, t, v) {
    noteLine(cv, t, v);
    const col = (blocks, x, w) => {
        cv.roundRect(x, ROW_Y, w, 5 * PITCH - 8, 14, withAlpha('#ffffff', 0.05));
        let y = ROW_Y + 34;
        blocks.forEach((b, i) => {
            txt(cv, b.title, x + 24, y, 22, i === 0 && x === X0 ? t.warn : t.text, { font: 'bold' });
            y += 26;
            b.lines.forEach((l) => { txt(cv, l, x + 24, y, 18, t.dim); y += 22; });
            y += 14;
        });
    };
    col(v.blocks, X0, 820);
    col(v.right, X0 + 840, W - 840);
}
/** s cut to maxW at size with an ellipsis: a long renderer reply never leaves its block. */
function fit(cv, s, size, maxW) {
    let x = String(s);
    if (cv.textWidth(x, size) <= maxW) return x;
    while (x.length > 4 && cv.textWidth(x + '...', size) > maxW) x = x.slice(0, -1);
    return x + '...';
}
/**
 * Safety: the setting rows and the test pattern row, then two blocks (the signals now with what cluster-render says;
 * the always-on guards, or the test step's result) of up to 5 lines, coloured by tone.
 */
function safetyPage(cv, t, v, act) {
    rowsPage(cv, t, v, act);
    const y = ROW_Y + v.rows.length * PITCH, h = 514 - y, bw = (W - 20) / 2;
    v.blocks.forEach((b, i) => {
        const x = X0 + i * (bw + 20);
        cv.roundRect(x, y, bw, h, 14, withAlpha('#ffffff', 0.05));
        txt(cv, b.title, x + 24, y + 26, 20, t.text, { font: 'bold' });
        b.lines.forEach((l, k) => txt(cv, fit(cv, l.text, 17, bw - 36), x + 24, y + 48 + k * 20, 17, toneOf(t, l.tone)));
    });
}

/** One screen's pages: tab(i) picks a page, draw(cv, t, m, act) draws it. */
function createUi() {
    let page = 0;
    return {
        page: () => page,
        tab(i) { if (typeof i === 'number' && Math.floor(i) === i && i >= 0 && i < P.PAGES.length) page = i; },
        draw(cv, t, m, act) {
            const own = !!cv.own, a = act || (() => () => {});
            if (!own) { G.frame(cv, t, ['M Track Cluster'], 0, []); homePage(cv, t, P.view(0, m), a, false); return; }
            G.frame(cv, t, P.PAGES, page, []);
            const v = P.view(page, m);
            if (v.id === 'home') homePage(cv, t, v, a, true);
            else if (v.id === 'about') aboutPage(cv, t, v);
            else if (v.id === 'safety') safetyPage(cv, t, v, a);
            else rowsPage(cv, t, v, a);
        },
    };
}

module.exports = { createUi };
