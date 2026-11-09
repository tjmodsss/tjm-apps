'use strict';
/**
 * homewidget.js - one home-screen widget per app, the same way for every app in arefahmad/idrive7-apps.
 * (Added to the kit by arefahmad/idrive7-apps; the widget machinery itself is mgu.js's Widget.)
 *
 * app.json needs a "startWidget" block (see any of this repository's apps). Then:
 *
 *   require('./kit/homewidget').start(ctx, () => ({
 *       label: 'ENGINE OIL',               // small caps line at the top
 *       value: '590 mi',                   // the big line
 *       sub: 'left until the next change', // under it
 *       bar: 0.8,                          // optional: a progress bar, 0..1
 *       tone: 'ok' | 'warn' | 'crit',      // optional: the bar's and the value's colour
 *       small: ['Oil: 590 mi left', ''],   // the small widget size's two text lines (it shows no pictures)
 *   }), { fps: 0.2 });
 *
 * The big size is a 384 x 256 picture drawn here, inside the margins the HMI keeps clear (it crops the
 * edges and darkens them). The picture is only drawn again when what it shows changes.
 *
 * Node 8: no ?., ??, object spread or optional catch binding.
 */
const { Canvas, withAlpha } = require('./canvas');

const WW = 384, WH = 256;
const SAFE = [0.09, 0.1];

function fit(cv, s, size, w, opt) {
    s = String(s || '');
    if (cv.textWidth(s, size, opt) <= w) return s;
    while (s.length > 1 && cv.textWidth(s + '...', size, opt) > w) s = s.slice(0, -1);
    return s + '...';
}

function draw(cv, d, t) {
    const x0 = Math.round(WW * SAFE[0]), y0 = Math.round(WH * SAFE[1]), w = WW - 2 * x0;
    const tone = d.tone === 'crit' ? (t.crit || '#ff3b30') : d.tone === 'warn' ? (t.warn || '#ffb31a') : (t.accent2 || t.accent || '#2fa8e8');
    cv.clear(t.bg || '#050506');
    cv.gradientRect(0, 0, WW, WH, [[0, t.panelTop || '#17181c'], [1, t.bg || '#050506']]);
    const L = { literal: true }, B = { font: 'bold', literal: true };
    cv.text(fit(cv, String(d.label || '').toUpperCase(), 14, w, B), x0, y0 + 20, 14, t.dim || '#8e9199', { font: 'bold', spacing: 1.5, literal: true });
    let size = 44;
    while (size > 24 && cv.textWidth(String(d.value || ''), size, B) > w) size -= 2;
    cv.text(fit(cv, d.value, size, w, B), x0, y0 + 20 + 22 + size * 0.8, size, d.tone && d.tone !== 'ok' ? tone : (t.text || '#ffffff'), B);
    const subY = y0 + 20 + 22 + size * 0.8 + 32;
    if (d.sub) cv.text(fit(cv, d.sub, 18, w, L), x0, subY, 18, '#d5d9e0', L);
    if (d.sub2) cv.text(fit(cv, d.sub2, 16, w, L), x0, subY + 24, 16, t.dim || '#8e9199', L);
    if (d.bar !== undefined && d.bar !== null) {
        const by = WH - y0 - 10;
        cv.roundRect(x0, by, w, 6, 3, withAlpha('#ffffff', 0.18));
        const f = Math.max(0, Math.min(1, d.bar));
        if (f > 0) cv.roundRect(x0, by, Math.max(6, Math.round(w * f)), 6, 3, tone);
    }
}

/**
 * Keep every placed widget showing content() (see above). opts.fps: how often content() is asked
 * (default once every 5 s). Does nothing on an app without a startWidget or on a unit without widgets.
 */
function start(ctx, content, opts) {
    if (!ctx.widget || typeof ctx.widget.loop !== 'function' || !ctx.spec || !ctx.spec.startWidget) return false;
    const cv = new Canvas(WW, WH);
    const cells = {};             // spawnId -> { cell: last value sent }
    let key = '';
    const send = (inst, name, value) => {
        const prev = cells[inst.spawnId] || (cells[inst.spawnId] = {});
        const v = JSON.stringify(value);
        if (prev[name] === v) return;
        prev[name] = v;
        ctx.widget.set(inst.spawnId, name, value, 'Text');
    };
    ctx.widget.loop((opts && opts.fps) || 0.2, (inst) => {
        let d;
        try { d = content() || {}; } catch (e) { ctx.log.warn('widget content: ' + e.message); d = { label: ctx.spec.title, value: '' }; }
        if (inst && !inst.big) {
            // the small size shows no pictures: two text lines (cells of the Drive Recorder widget layout)
            const s = d.small || [d.value, d.sub];
            send(inst, 'Title', String(s[0] || ctx.spec.title));
            send(inst, 'TextRecordings', String(s[1] || ''));
            return null;
        }
        if (inst) { send(inst, 'Title', ''); send(inst, 'TextRecordings', ''); }
        const t = ctx.theme();
        const k = JSON.stringify([d, t.bg, t.accent]);
        if (k !== key) { key = k; draw(cv, d, t); }
        return cv;
    });
    ctx.widget.onChange((why) => {
        if (why === 'resized' || why === 'placed' || why === 'shown') { Object.keys(cells).forEach((k) => delete cells[k]); key = ''; }
    });
    return true;
}

/** The app.json "startWidget" block every app here uses (copied into each app.json). */
const SPEC = {
    layout: 'LT_Table_OnlineApps_DriveRecorderWidget', image: 'BackgroundImage1', size: [WW, WH], safe: SAFE,
    cells: {
        ErrorInfo: [false, 'Bool'], background: [true, 'Bool'], Title: ['', 'Text'], ProgressbarVisible: [false, 'Bool'],
        Progress: [0, 'Float'], TextRecordings: ['', 'Text'], TextCam: ['', 'Text'], TimeElapsed: ['', 'Text'], TimeRemaining: ['', 'Text'],
    },
};

module.exports = { start, draw, SPEC, WW, WH };
