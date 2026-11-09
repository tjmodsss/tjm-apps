'use strict';
/**
 * Car Care: your own service intervals, kept apart from BMW's. Each item (engine oil, plugs, coils,
 * fluids, filters) has its own interval in miles or months, set in Settings, and shows how much is left.
 * Done today records the car's odometer and the date; Done earlier sets a service from before the app.
 *
 * It never resets or writes BMW's own service reminders (CBS): a dealer's free oil change still comes due
 * on BMW's schedule while this app counts your own 3,000-mile changes.
 *
 * Read-only toward the car: it reads the odometer from the instrument cluster's signal.
 *
 * Node 8 only (the car's version). Nothing may throw out of a callback: every callback goes through guard().
 */
const fs = require('fs');
const path = require('path');
const mgu = require('./kit/mgu');
const C = require('./items');
const HW = require('./kit/homewidget');

const VERSION = '0.2.1';
const W = 1600, H = 520;
const ROWS = 7;
const KOMBI = 'de.bmw.infotainment.KombiIF';
const NORMAL = ['BTN_NEXT', 'BTN_DONE', 'BTN_EARLIER', 'BTN_SETTINGS'];
const ENTRY_MI = ['BTN_KM_UP', 'BTN_KM_UP2', 'BTN_KM_DOWN2', 'BTN_KM_DOWN'];
const ENTRY_MO = ['BTN_MO_UP', 'BTN_MO_DOWN'];
const ENTRY = ENTRY_MI.concat(ENTRY_MO, ['BTN_SAVE', 'BTN_CANCEL']);

mgu.run({
    async start(ctx) {
        const { ui, settings, log } = ctx;
        const guard = (name, fn) => function () {
            try { return fn.apply(this, arguments); } catch (e) { log.error('error in ' + name + ': ' + (e && e.stack || e)); return undefined; }
        };
        try {
            const FILE = path.join(ctx.dataDir, 'carcare.json');
            let data = { recs: {}, odo: null };
            try { data = Object.assign(data, JSON.parse(fs.readFileSync(FILE, 'utf8'))); } catch (e) { /* first run */ }
            const save = () => { try { fs.writeFileSync(FILE, JSON.stringify(data)); } catch (e) { log.warn('save: ' + e.message); } };

            /* ---------- the odometer (km), from the instrument cluster ---------- */
            let odoLive = false;
            ctx.signals.watch(KOMBI, '1', {
                statusRangeTankStatus: guard('odometer', (v) => {
                    const k = v && v.mileageKilometre;
                    if (!(typeof k === 'number' && k > 0 && k < 16777215)) return;
                    if (!odoLive) log.info('odometer: ' + k + ' km');
                    odoLive = true;
                    if (k !== data.odo) { data.odo = k; save(); }
                }),
            }, log, { pollMs: 30000 }).then((r) => { if (r && r.error) log.warn('odometer: ' + r.error); });

            const us = () => settings.get('units') !== 'metric';
            const intervals = () => { const o = {}; C.ITEMS.forEach((it) => { o[it.setting] = settings.get(it.setting); }); return o; };
            const odoText = (km) => (km === null || km === undefined ? '-' : us() ? C.commas(km / C.MI) + ' mi' : C.commas(km) + ' km');
            const when = (t) => { const d = new Date(t); return (d.getMonth() + 1) + '/' + d.getDate() + '/' + d.getFullYear(); };

            /* ---------- selection, Done today, Done earlier ---------- */
            let sel = 0, armDone = 0, entry = null, toast = null;
            const say = (text, ms) => { toast = { text: text, until: Date.now() + (ms || 3500) }; };
            const item = () => C.ITEMS[sel];
            const shown = (id, on) => {
                const D = ctx.display;
                ui.visible(id, on && !(D && D.hmiBarHidden));
                if (D && D.ownHidden) {
                    if (on) D.ownHidden.delete(id); else D.ownHidden.add(id);
                    D._btns = null;
                    if (D.place && typeof D._place === 'function') D._place();
                }
            };
            const showButtons = () => {
                NORMAL.forEach((b) => shown(b, !entry));
                ENTRY_MI.forEach((b) => shown(b, !!entry && item().unit === 'mi'));
                ENTRY_MO.forEach((b) => shown(b, !!entry));
                ['BTN_SAVE', 'BTN_CANCEL'].forEach((b) => shown(b, !!entry));
                ui.text('BTN_DONE', armDone && Date.now() - armDone < 5000 ? 'Press again to confirm' : 'Done today');
            };
            ctx.onLayout(guard('layout', () => showButtons()));
            showButtons();

            ui.onClick('BTN_NEXT', guard('next', () => { sel = (sel + 1) % C.ITEMS.length; armDone = 0; showButtons(); }));
            ui.onClick('BTN_DONE', guard('done', () => {
                if (data.odo === null) { say('No odometer reading yet: turn the ignition on'); return; }
                if (!armDone || Date.now() - armDone > 5000) { armDone = Date.now(); showButtons(); setTimeout(guard('disarm', () => { armDone = 0; showButtons(); }), 5100); return; }
                armDone = 0;
                data.recs[item().key] = { km: data.odo, at: Date.now() };
                save(); showButtons();
                log.info('done: ' + item().key + ' at ' + data.odo + ' km');
                say(item().name + ': done today at ' + odoText(data.odo));
            }));
            ui.onClick('BTN_EARLIER', guard('earlier', () => {
                if (data.odo === null && item().unit === 'mi') { say('No odometer reading yet: turn the ignition on'); return; }
                entry = { miAgo: 0, moAgo: 0 };
                showButtons();
            }));
            const stepMi = (d) => () => { if (entry) entry.miAgo = Math.max(0, entry.miAgo + d); };
            const stepMo = (d) => () => { if (entry) entry.moAgo = Math.max(0, entry.moAgo + d); };
            ui.onClick('BTN_KM_UP', guard('mi+1000', stepMi(1000)));
            ui.onClick('BTN_KM_UP2', guard('mi+100', stepMi(100)));
            ui.onClick('BTN_KM_DOWN2', guard('mi-100', stepMi(-100)));
            ui.onClick('BTN_KM_DOWN', guard('mi-1000', stepMi(-1000)));
            ui.onClick('BTN_MO_UP', guard('mo+1', stepMo(1)));
            ui.onClick('BTN_MO_DOWN', guard('mo-1', stepMo(-1)));
            ui.onClick('BTN_CANCEL', guard('cancel', () => { entry = null; showButtons(); }));
            ui.onClick('BTN_SAVE', guard('save entry', () => {
                if (!entry) return;
                const kmAgo = us() ? entry.miAgo * C.MI : entry.miAgo;
                const odo = data.odo !== null ? data.odo : 0;
                data.recs[item().key] = { km: Math.max(0, Math.round(odo - kmAgo)), at: Date.now() - entry.moAgo * 30.44 * 86400000 };
                save();
                log.info('done earlier: ' + item().key + ' ' + JSON.stringify(data.recs[item().key]));
                say(item().name + ': saved');
                entry = null; showButtons();
            }));

            /* ---------- drawing ---------- */
            const fit = (cv, s, size, w, opt) => {
                s = String(s || '');
                if (cv.textWidth(s, size, opt) <= w) return s;
                while (s.length > 1 && cv.textWidth(s + '...', size, opt) > w) s = s.slice(0, -1);
                return s + '...';
            };
            ctx.loop('MAIN', 2, guard('draw', async () => {
                const t = ctx.theme(), cv = ctx.canvas(W, H).clear(t.bg), L = { literal: true };
                const iv = intervals(), now = Date.now();
                if (entry) {
                    const it = item();
                    cv.text(it.name + ': done earlier', 40, 50, 30, t.text, { font: 'bold', literal: true });
                    const u = us() ? 'mi' : 'km';
                    const lines = [];
                    if (it.unit === 'mi') lines.push(C.commas(entry.miAgo) + ' ' + u + ' ago (at ' + odoText(Math.max(0, data.odo - (us() ? entry.miAgo * C.MI : entry.miAgo))) + ')');
                    lines.push(entry.moAgo + ' month' + (entry.moAgo === 1 ? '' : 's') + ' ago');
                    lines.forEach((l, i) => cv.text(l, W / 2, 210 + i * 90, 64, t.text, { font: 'bold', align: 'center', literal: true }));
                    cv.text('Set when it was done with the buttons below, then Save.', W / 2, 440, 18, t.dim, { align: 'center', literal: true });
                } else {
                    cv.text('Car Care', 40, 50, 30, t.text, { font: 'bold', literal: true });
                    cv.text('Odometer ' + odoText(data.odo) + (odoLive ? '' : data.odo !== null ? ' (last seen)' : ' (waiting for the car)') + '   ·   BMW\'s own service reminders are not touched', W - 40, 50, 18, t.dim, { align: 'right', literal: true });
                    const first = Math.floor(sel / ROWS) * ROWS;
                    C.ITEMS.slice(first, first + ROWS).forEach((it, i) => {
                        const k = first + i, y = 84 + i * 58, rec = data.recs[it.key];
                        const r = C.status(it, rec, data.odo, now, C.intervalOf(it, iv));
                        const col = !r.known ? t.dim : r.due ? (t.crit || '#ff3b30') : r.soon ? (t.warn || '#ffb31a') : (t.ok || t.accent);
                        if (k === sel) cv.roundRect(28, y - 6, W - 56, 54, 12, t.panelTop || '#17181c');
                        const every = C.commas(C.intervalOf(it, iv)) + (it.unit === 'mi' ? ' mi' : ' months') + (it.months ? ' or ' + it.months + ' months' : '');
                        cv.text(fit(cv, it.name, 22, 380, L), 44, y + 18, 22, k === sel ? t.text : t.text, { font: k === sel ? 'bold' : undefined, literal: true });
                        cv.text('every ' + every, 44, y + 40, 15, t.dim, L);
                        // the bar: how much of the interval is used
                        const bx = 470, bw = 520;
                        cv.roundRect(bx, y + 14, bw, 12, 6, t.track || '#222329');
                        if (r.known) cv.roundRect(bx, y + 14, Math.max(12, Math.min(1, r.frac) * bw), 12, 6, col);
                        cv.text(fit(cv, C.leftText(r, settings.get('units')), 22, 330, L), 1020, y + 26, 22, col, L);
                        cv.text(rec ? 'last ' + when(rec.at) : '', W - 44, y + 26, 16, t.dim, { align: 'right', literal: true });
                    });
                }
                if (toast && Date.now() < toast.until) {
                    const w = cv.textWidth(toast.text, 22, L) + 60;
                    cv.roundRect((W - w) / 2, H - 66, w, 46, 23, '#2a2b31');
                    cv.text(toast.text, W / 2, H - 36, 22, '#ffffff', { align: 'center', literal: true });
                }
                await ui.image('MAIN_GFX', cv);
            }));
            /* ---------- home-screen widget: the item closest to due ---------- */
            HW.start(ctx, () => {
                const iv = intervals(), now = Date.now();
                let best = null;
                C.ITEMS.forEach((it) => {
                    const r = C.status(it, data.recs[it.key], data.odo, now, C.intervalOf(it, iv));
                    if (r.known && (!best || r.frac > best.r.frac)) best = { it, r };
                });
                if (!best) return { label: 'Car Care', value: 'Set up', sub: 'Record your last services', small: ['Car Care', 'Record your last services'] };
                const left = C.leftText(best.r, settings.get('units')).split('; ')[0];
                const tone = best.r.due ? 'crit' : best.r.soon ? 'warn' : 'ok';
                const m = /^([\d,]+ (?:mi|km|months|days)) (left|over)$/.exec(left);
                return { label: best.it.name, value: m ? m[1] : left, sub: m ? (m[2] === 'over' ? 'overdue' : 'left') : '', bar: best.r.frac, tone,
                    small: [best.it.name, left] };
            });
            log.info('started ' + VERSION + ' (odometer last seen ' + data.odo + ' km)');
        } catch (e) {
            log.error('start: ' + (e && e.stack || e));
        }
    },
});
