'use strict';
/**
 * ui.js - the centre screen (1600 x 520): six pages under header tabs (Home, HUD, Cluster, Behavior, About, Check),
 * drawn from pages.js with the kit's own parts: G.frame tabs, G.button pills, cv.target rows. The kit draws the
 * controller's focus ring and runs a press. Where the kit does not run the screen (Software renderer, Standard
 * layout, no touch routing) there are no page buttons: a read-only Home, and the bar's Settings button opens the
 * HMI's settings list.
 *
 * Drawn only on a change (main.js), never per frame: no live numbers. Only roundRect, strokeRoundRect, circle, text
 * and fillRect (the GPU Recorder and the software Canvas both have them; KB-ANY-198). ASCII text only.
 * act(writes, cmd) -> the function a press runs (main.js saves the writes inside safety.guard; cmd: a Check tab command).
 * A control with confirm (Reset HUD to defaults) asks first, as the kit's G.button confirm does: the first press turns it into
 * "Confirm reset" for ARM_MS, a second press then runs it. The kit's own confirm redraws through a render loop this app does
 * not have, so the pages keep that state and ask main.js for a draw (createUi(redraw)).
 */
const { withAlpha } = require('./kit/canvas');
const G = require('./kit/gauges');
const P = require('./pages');

const X0 = 40, W = 1520, NOTE_Y = 76, ROW_Y = 92, ROW_H = 62, PITCH = 70, CTL_H = 44;
const PILL_OPT = { font: 'bold', spacing: 1.5 };
const ARM_MS = 5000;        // a confirm control's second press must come within this (the kit's G.button: 5 s)

const toneOf = (t, tone) => (tone === 'warn' ? t.warn : tone === 'crit' ? t.crit : tone === 'on' ? t.text : t.dim);
const txt = (cv, s, x, y, size, c, o) => cv.text(String(s), x, y, size, c, Object.assign({ literal: true }, o));

/** The kit's settings switch (sheet.js toggle), w x h, dimmed when the row is off. */
function sw(cv, t, x, y, w, h, on, enabled) {
    const S = t.sel || t.accent;
    cv.roundRect(x, y, w, h, h / 2, on ? withAlpha(S, enabled ? 1 : 0.35) : withAlpha('#ffffff', enabled ? 0.16 : 0.08));
    cv.circle(on ? x + w - h / 2 : x + h / 2, y + h / 2, h / 2 - 5, withAlpha('#ffffff', enabled ? 1 : 0.4));
}

/** Pills' widths for texts (G.button's text: upper case, h * 0.4). */
function pillWidths(cv, texts) {
    return texts.map((s) => Math.max(104, Math.ceil(cv.textWidth(String(s).toUpperCase(), CTL_H * 0.4, PILL_OPT)) + 40));
}

/** The control part of a row, right-aligned at xr, centred on cy. Targets left to right. */
function control(cv, t, r, xr, cy, act) {
    const y = cy - CTL_H / 2;
    if (r.kind === 'toggle') { sw(cv, t, xr - 76, cy - 19, 76, 38, r.controls[0].on, r.enabled); return; }
    if (!cv.own) {          // read-only: the value in words (G.button draws nothing there)
        txt(cv, r.value, xr, cy + 8, 22, r.enabled ? t.text : t.dim, { align: 'right', font: 'bold' });
        return;
    }
    if (r.kind === 'pills') {
        const ws = pillWidths(cv, r.controls.map((c) => c.text)), gap = 10;
        let x = xr - ws.reduce((a, b) => a + b + gap, -gap);
        r.controls.forEach((c, i) => {
            G.button(cv, t, x, y, ws[i], CTL_H, c.text, act(c.writes), { key: c.key, primary: c.on, busy: !r.enabled });
            x += ws[i] + gap;
        });
        return;
    }
    stepper(cv, t, r.controls, r.value, xr - STEP_W, y, r.enabled, act);
}

const VAL_W = 176, STEP_W = CTL_H + 8 + VAL_W + 8 + CTL_H;
/** [-] value [+]: an end stays a button (the focus never jumps) drawn dim; a disabled row has no buttons. */
function stepper(cv, t, controls, value, x, y, enabled, act) {
    const btn = (c, bx) => {
        G.button(cv, t, bx, y, CTL_H, CTL_H, ' ', act(c.writes), { key: c.key, busy: !enabled, color: c.end && enabled ? t.dim : undefined });
        // the sign drawn as bars: the button's own text (h * 0.4) is too small for one character
        const col = enabled && !c.end ? t.text : withAlpha(t.dim, 0.7), cx = bx + CTL_H / 2, cy = y + CTL_H / 2;
        cv.fillRect(cx - 8, cy - 1.5, 16, 3, col);
        if (c.text === '+') cv.fillRect(cx - 1.5, cy - 8, 3, 16, col);
    };
    btn(controls[0], x);
    cv.roundRect(x + CTL_H + 8, y, VAL_W, CTL_H, 10, withAlpha('#ffffff', 0.04));
    txt(cv, value, x + CTL_H + 8 + VAL_W / 2, y + CTL_H / 2 + 8, 22, enabled ? t.text : t.dim, { align: 'center', font: 'bold' });
    btn(controls[1], x + CTL_H + 8 + VAL_W + 8);
}

/** One settings row: label, one-line description under it, the control on the right. */
function drawRow(cv, t, r, x, y, w, act, h) {
    const rh = h || ROW_H, d = rh - ROW_H;      // a short row (the HUD page has seven) lifts its text by d
    cv.roundRect(x, y, w, rh, 14, withAlpha('#ffffff', 0.05));
    txt(cv, r.label, x + 24, y + 28 + Math.round(d / 2), 24, r.enabled ? t.text : t.dim);
    txt(cv, r.desc, x + 24, y + 51 + d, 18, t.dim);
    control(cv, t, r, x + w - 18, y + rh / 2, act);
    if (r.kind === 'toggle' && r.enabled && cv.own) cv.target(x, y, w, rh, act(r.controls[0].writes), r.controls[0].key, 14);
}

/** The line under the tabs; a button at its right (e.g. "Turn HUD on", or a confirm control: arm(a) runs its presses). */
function noteLine(cv, t, v, act, arm) {
    if (!v.note) return;
    txt(cv, v.note, X0 + 4, NOTE_Y, 22, toneOf(t, v.noteTone), { font: 'bold' });
    if (v.noteAction && cv.own) {
        const a = v.noteAction, c = a.confirm && arm ? arm(a) : null, text = c ? c.text : a.text, bw = pillWidths(cv, [text])[0];
        const opts = c ? { key: a.key, primary: c.armed, color: t.crit, busy: !!a.busy } : { key: a.key, primary: true, busy: !!a.busy };
        G.button(cv, t, X0 + W - bw, NOTE_Y - 34, bw, 40, text, c ? c.run : act(a.writes), opts);
    }
}

function homePage(cv, t, v, act, own) {
    const S = t.sel || t.accent, top = own ? 52 : 48, ch = 250, cw = (W - 32) / 2;
    v.cards.forEach((c, i) => {
        const x = X0 + i * (cw + 32), y = top;
        cv.roundRect(x, y, cw, ch, 18, withAlpha('#ffffff', 0.05));
        cv.roundRect(x, y, 8, ch, 4, c.on ? S : withAlpha('#ffffff', 0.15));
        txt(cv, c.label, x + 40, y + 54, 26, t.text, { font: 'bold' });
        txt(cv, c.on ? 'ON' : 'OFF', x + 38, y + 150, 72, c.on ? t.text : t.dim, { font: 'bold', spacing: 2 });
        const state = c.on ? c.state.text : own ? 'Press to turn on' : '';
        txt(cv, state, x + 40, y + 206, 22, toneOf(t, c.state.tone), { font: 'bold' });
        sw(cv, t, x + cw - 40 - 112, y + ch / 2 - 28, 112, 56, c.on, true);
        if (own) cv.target(x, y, cw, ch, act(c.controls[0].writes), c.controls[0].key, 18);
    });
    const ry = top + ch + 16;
    drawRow(cv, t, v.rows[0], X0, ry, W, act);
    // status: the drive mode, why nothing shows (if so), and the kill switch
    const sy = ry + ROW_H + 16;
    cv.roundRect(X0, sy, W, ROW_H + 8, 14, withAlpha('#ffffff', 0.05));
    const off = v.status.off, crit = off.indexOf('STOPPED') === 0;
    if (off) {
        cv.roundRect(X0, sy, 8, ROW_H + 8, 4, crit ? t.crit : t.warn);
        txt(cv, off, X0 + 24, sy + 30, 22, crit ? t.crit : t.warn, { font: 'bold' });
        txt(cv, v.status.mode, X0 + 24, sy + 56, 18, t.dim);
    } else txt(cv, v.status.mode, X0 + 24, sy + 43, 22, t.text);
    if (own) {
        const a = v.alloff, bw = 200;
        G.button(cv, t, X0 + W - 18 - bw, sy + 11, bw, 48, a.text, act(a.writes), { key: a.key, color: t.crit });
        txt(cv, 'Kill switch', X0 + W - 18 - bw - 20, sy + 43, 18, t.dim, { align: 'right' });
    } else txt(cv, 'Buttons below: HUD on/off, Cluster on/off, Settings (every setting)', X0 + W - 18, sy + 43, 18, t.dim, { align: 'right' });
}

function displayPage(cv, t, v, act, arm) {
    noteLine(cv, t, v, act, arm);
    const n = v.rows.length, h = n > 6 ? 54 : ROW_H, pitch = n > 6 ? 60 : PITCH;   // seven rows (HUD) must still end above the screen's bottom
    v.rows.forEach((r, i) => drawRow(cv, t, r, X0, ROW_Y + i * pitch, W, act, h));
}

function behaviorPage(cv, t, v, act) {
    noteLine(cv, t, v, act);
    const lw = 760;
    v.rows.forEach((r, i) => drawRow(cv, t, r, X0, ROW_Y + i * PITCH, lw, act));
    // shift points: a mode a row, first light and shift side by side
    const px = X0 + lw + 20, pw = W - lw - 20, py = ROW_Y, ph = 5 * PITCH - 8;
    cv.roundRect(px, py, pw, ph, 14, withAlpha('#ffffff', 0.05));
    txt(cv, 'Shift points', px + 24, py + 34, 24, t.text, { font: 'bold' });
    const c1 = px + pw - 18 - 2 * STEP_W - 16, c2 = px + pw - 18 - STEP_W;
    txt(cv, 'First light', c1 + STEP_W / 2, py + 34, 18, t.dim, { align: 'center', font: 'bold' });
    txt(cv, 'Shift (all red)', c2 + STEP_W / 2, py + 34, 18, t.dim, { align: 'center', font: 'bold' });
    v.modes.forEach((m, i) => {
        const y = py + 52 + i * 58;
        txt(cv, m.label, px + 24, y + CTL_H / 2 + 8, 24, m.enabled ? (m.invalid ? t.warn : t.text) : t.dim, { font: 'bold' });
        stepper(cv, t, m.start.controls, m.start.value, c1, y, m.enabled, act);
        stepper(cv, t, m.shift.controls, m.shift.value, c2, y, m.enabled, act);
    });
    v.notes.slice(0, 4).forEach((n, i) => txt(cv, n.text, px + 24, py + 52 + 3 * 58 + 30 + i * 26, 18, toneOf(t, n.tone)));
}

function aboutPage(cv, t, v, act) {
    noteLine(cv, t, v, act);
    const lw = 760, h = 5 * PITCH - 8;
    cv.roundRect(X0, ROW_Y, lw, h, 14, withAlpha('#ffffff', 0.05));
    let y = ROW_Y + 34;
    v.blocks.forEach((b) => {
        txt(cv, b.title, X0 + 24, y, 22, t.text, { font: 'bold' });
        y += 26;
        b.lines.forEach((l) => { txt(cv, l, X0 + 24, y, 18, t.dim); y += 22; });
        y += 14;
    });
    const rx = X0 + lw + 20, rw = W - lw - 20;
    txt(cv, 'Rarely needed', rx + 4, ROW_Y + 30, 22, t.text, { font: 'bold' });
    v.rows.forEach((r, i) => drawRow(cv, t, r, rx, ROW_Y + 44 + i * PITCH, rw, act));
    txt(cv, v.rowsNote, rx + 4, ROW_Y + 44 + v.rows.length * PITCH + 14, 18, t.dim);
}

/** The Check tab (0.4.4): the verdict, its detail, the proof as label / value lines, the buttons at the verdict's right. */
function checkPage(cv, t, v, act) {
    txt(cv, v.note, X0 + 4, NOTE_Y, 26, toneOf(t, v.noteTone), { font: 'bold' });
    txt(cv, v.detail, X0 + 4, NOTE_Y + 32, 20, t.dim);
    const ws = pillWidths(cv, v.buttons.map((b) => b.text)), gap = 12;
    let x = X0 + W - ws.reduce((a, b) => a + b + gap, -gap);
    v.buttons.forEach((b, i) => {
        G.button(cv, t, x, NOTE_Y - 34, ws[i], 40, b.text, act(b.writes, b.cmd), { key: b.key, primary: b.cmd === 'hudReset', busy: !!b.busy });
        x += ws[i] + gap;
    });
    const top = 128, pitch = 27;     // 11 proof rows (0.4.5) and the foot inside the 520 px canvas
    cv.roundRect(X0, top, W, v.lines.length * pitch + 22, 14, withAlpha('#ffffff', 0.05));
    v.lines.forEach((l, i) => {
        const y = top + 32 + i * pitch;
        txt(cv, l[0], X0 + 24, y, 20, t.dim, { font: 'bold' });
        txt(cv, l[1], X0 + 300, y, 20, t.text);
    });
    txt(cv, v.foot, X0 + 4, top + v.lines.length * pitch + 56, 18, t.dim);
}

/**
 * One screen's pages: tab(i) picks a page, draw(cv, t, m, act) draws it. redraw(): main.js's coalesced draw, asked when a
 * confirm control arms and when its ARM_MS run out.
 */
function createUi(redraw) {
    let page = 0, armed = null;            // armed: { key, at } of a confirm control pressed once
    const again = typeof redraw === 'function' ? redraw : () => {};
    // a clock set back counts as run out (one more press asks again)
    const live = (key) => { const now = Date.now(); return !!armed && armed.key === key && now >= armed.at && now - armed.at < ARM_MS; };
    /** A confirm control's look and press: { text, armed, run }. */
    const arm = (act) => (a) => {
        const on = live(a.key);
        return {
            text: on ? 'Confirm reset' : a.text, armed: on,
            run: () => {
                if (live(a.key)) { armed = null; again(); return act(a.writes)(); }
                armed = { key: a.key, at: Date.now() };
                again();
                setTimeout(again, ARM_MS + 50);
                return null;
            },
        };
    };
    return {
        page: () => page,
        /** Header tab i (from ctx.onTab); anything out of range is ignored. */
        tab(i) { if (typeof i === 'number' && Math.floor(i) === i && i >= 0 && i < P.PAGES.length) page = i; },
        draw(cv, t, m, act) {
            const own = !!cv.own, a = act || (() => () => {});
            if (!own) { G.frame(cv, t, ['Shift Lights'], 0, []); homePage(cv, t, P.view(0, m), a, false); return; }
            G.frame(cv, t, P.PAGES, page, []);
            const v = P.view(page, m);
            if (v.id === 'home') homePage(cv, t, v, a, true);
            else if (v.id === 'behavior') behaviorPage(cv, t, v, a);
            else if (v.id === 'about') aboutPage(cv, t, v, a);
            else if (v.id === 'check') checkPage(cv, t, v, a);
            else displayPage(cv, t, v, a, arm(a));
        },
    };
}

module.exports = { createUi };
