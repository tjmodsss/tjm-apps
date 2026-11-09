'use strict';
/**
 * Drive Log: records every drive in the background (it starts with the car) and keeps its numbers:
 * distance, time moving, top speed, best 0-60 mph, peak rpm, the most acceleration, braking and cornering
 * g, and the highest oil and coolant temperatures. "This drive" shows the drive going on (or the last one),
 * "History" the ones before, "0-60 runs" every run, and Save CSV writes the drives to drives.csv.
 *
 * Dragy calibration (setting "Compare with Dragy"): after a run, Enter Dragy time asks for the time the
 * Dragy showed. From 3 runs timed both ways on, every run also gets an adjusted time: what a Dragy would
 * most likely have shown (log/dragy.js). The adjustment stays after the setting is turned off.
 *
 * Read-only: it only listens to the car's own driving signals (speed, rpm, g-forces, temperatures, gear).
 *
 * Node 8 only (the car's version). Nothing may throw out of a callback: every callback goes through guard().
 */
const fs = require('fs');
const path = require('path');
const mgu = require('./kit/mgu');
const Car = require('./kit/car');
const { Trips, csv } = require('./trip');
const { DragyCal, READY_N } = require('./dragy');
const HW = require('./kit/homewidget');

const VERSION = '0.3.1';
const W = 1600, H = 520;
const SAVE_MS = 30000;
const ROWS = 7;
const VIEWS = ['drive', 'history', 'runs'];
const VIEW_NAME = { drive: 'This drive', history: 'History', runs: '0-60 runs' };
const NORMAL = ['BTN_VIEW', 'BTN_DRAGY', 'BTN_EXPORT', 'BTN_MORE', 'BTN_SETTINGS'];
const ENTRY = ['BTN_UP', 'BTN_DOWN', 'BTN_UP2', 'BTN_DOWN2', 'BTN_SAVE', 'BTN_SKIP'];

mgu.run({
    async start(ctx) {
        const { ui, settings, log } = ctx;
        const guard = (name, fn) => function () {
            try { return fn.apply(this, arguments); } catch (e) { log.error('error in ' + name + ': ' + (e && e.stack || e)); return undefined; }
        };
        try {
            const FILE = path.join(ctx.dataDir, 'drivelog.json'), CSV = path.join(ctx.dataDir, 'drives.csv');
            let saved = null;
            try { saved = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { /* first run */ }
            const tr = new Trips(saved);
            const cal = new DragyCal(saved && saved.runs);
            let dirty = !!(saved && saved.current);
            const state = () => { const s = tr.state(); s.runs = cal.runs; return s; };
            const save = () => { try { fs.writeFileSync(FILE, JSON.stringify(state())); dirty = false; } catch (e) { log.warn('save: ' + e.message); } };
            if (dirty) save();

            const car = new Car(ctx, ['rpm', 'speed', 'accel', 'temps', 'gear'], { demo: false });
            let had = !!tr.current;
            car.onSample(guard('sample', (d, t) => {
                const before = tr.trips.length;
                tr.feed(d, t || Date.now());
                if (tr.current) dirty = true;
                if (tr.current && !had) log.info('drive started');
                while (tr.newRuns.length) {
                    const r = tr.newRuns.shift();
                    cal.addRun(r.at, r.s);
                    log.info('0-60: ' + r.s + ' s (car speed)' + (cal.adjusted(r.s) !== null ? ', Dragy-adjusted ' + cal.adjusted(r.s) + ' s' : ''));
                    save();
                }
                if (tr.trips.length > before) { const c = tr.trips[tr.trips.length - 1]; log.info('drive ended: ' + c.km + ' km, top ' + c.topKmh + ' km/h, best 0-60 ' + c.best060); save(); }
                had = !!tr.current;
            }));
            setInterval(guard('save', () => { if (dirty) save(); }), SAVE_MS);
            // the car switching off stops the app: close the drive with it
            process.once('exit', () => { try { if (tr.current) { tr.end(Date.now()); fs.writeFileSync(FILE, JSON.stringify(state())); } } catch (e) { /* too late */ } });

            /* ---------- views, and the Dragy entry ---------- */
            let view = 'drive', page = 0, toast = null;
            let entry = null;                    // { id, car, value } while a Dragy time is entered
            const say = (text, ms) => { toast = { text: text, until: Date.now() + (ms || 3500) }; };
            const dragyOn = () => !!settings.get('dragy');
            /**
             * Show or hide one bar button on both paths: the HMI's own bar (ui.visible; kept hidden while the kit
             * draws the bar itself) and the bar the kit draws with the GPU renderer (its hidden set).
             */
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
                NORMAL.forEach((b) => shown(b, !entry && (b !== 'BTN_DRAGY' || dragyOn())));
                ENTRY.forEach((b) => shown(b, !!entry));
                ui.text('BTN_VIEW', VIEW_NAME[VIEWS[(VIEWS.indexOf(view) + 1) % VIEWS.length]]);
            };
            settings.onChange(guard('setting', () => showButtons()));
            // the kit switches between its own bar and the HMI's (renderer up or down): apply ours again
            ctx.onLayout(guard('layout', () => showButtons()));
            showButtons();
            ui.onClick('BTN_VIEW', guard('view', () => { view = VIEWS[(VIEWS.indexOf(view) + 1) % VIEWS.length]; page = 0; showButtons(); }));
            ui.onClick('BTN_MORE', guard('more', () => { page++; }));
            ui.onClick('BTN_EXPORT', guard('export', () => {
                fs.writeFileSync(CSV, csv(tr.trips.concat(tr.current ? [tr.current] : []), settings.get('units')));
                say('Saved ' + (tr.trips.length + (tr.current ? 1 : 0)) + ' drives to drives.csv');
            }));
            ui.onClick('BTN_DRAGY', guard('dragy', () => {
                const r = cal.pending();
                if (!r) { say('No run waiting for a Dragy time (runs from the last 7 days)'); return; }
                entry = { id: r.id, car: r.car, at: r.at, value: cal.guess(r.car) };
                showButtons();
            }));
            const step = (d) => () => { if (entry) entry.value = Math.max(1, Math.min(30, Math.round((entry.value + d) * 100) / 100)); };
            ui.onClick('BTN_UP', guard('up', step(0.1)));
            ui.onClick('BTN_DOWN', guard('down', step(-0.1)));
            ui.onClick('BTN_UP2', guard('up2', step(0.01)));
            ui.onClick('BTN_DOWN2', guard('down2', step(-0.01)));
            ui.onClick('BTN_SAVE', guard('save run', () => {
                if (!entry) return;
                cal.setDragy(entry.id, entry.value);
                const s = cal.stats();
                log.info('Dragy ' + entry.value + ' s for car ' + entry.car + ' s; offset ' + s.offset + ' over ' + s.n + ' runs');
                say(s.ready ? 'Saved. Offset now ' + (s.offset > 0 ? '+' : '') + s.offset.toFixed(2) + ' s over ' + s.n + ' runs' : 'Saved. ' + (READY_N - s.n) + ' more run' + (READY_N - s.n === 1 ? '' : 's') + ' until adjusted times show');
                entry = null; save(); showButtons();
            }));
            ui.onClick('BTN_SKIP', guard('skip', () => { if (!entry) return; cal.skip(entry.id); entry = null; save(); showButtons(); say('Skipped: this run has no Dragy time'); }));

            /* ---------- units and text ---------- */
            const us = () => settings.get('units') !== 'metric';
            const dist = (km) => (us() ? (km * 0.621371).toFixed(1) + ' mi' : km.toFixed(1) + ' km');
            const spd = (kmh) => (us() ? Math.round(kmh * 0.621371) + ' mph' : Math.round(kmh) + ' km/h');
            const temp = (c) => (c === null || c === undefined ? '-' : us() ? Math.round(c * 1.8 + 32) + ' F' : Math.round(c) + ' C');
            const dur = (ms) => { const m = Math.round(ms / 60000); return m >= 60 ? Math.floor(m / 60) + ' h ' + (m % 60) + ' min' : m + ' min'; };
            const when = (t) => { const d = new Date(t); return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0'); };
            const g = (x) => (x ? x.toFixed(2) + ' g' : '-');
            const secs = (x) => (x === null || x === undefined ? '-' : x.toFixed(2) + ' s');

            function drawEntry(cv, t, L) {
                cv.text('Dragy time for this run', 40, 50, 30, t.text, { font: 'bold', literal: true });
                cv.text('Run at ' + when(entry.at) + '   ·   Drive Log timed it at ' + secs(entry.car) + ' (car speed)', 40, 92, 20, t.dim, L);
                cv.text(entry.value.toFixed(2) + ' s', W / 2, 290, 120, t.text, { font: 'bold', align: 'center', literal: true });
                const d = entry.value - entry.car;
                cv.text('Dragy minus car: ' + (d >= 0 ? '+' : '') + d.toFixed(2) + ' s', W / 2, 350, 24, t.dim, { align: 'center', literal: true });
                cv.text('Set the time with the buttons below, then Save. Enter it the same way every run (with or without rollout).', W / 2, 440, 18, t.dim, { align: 'center', literal: true });
            }
            function drawDrive(cv, t, L) {
                const c = tr.current || tr.trips[tr.trips.length - 1];
                cv.text(tr.current ? 'This drive' : c ? 'Last drive' : 'No drives yet', 40, 50, 30, t.text, { font: 'bold', literal: true });
                if (c) cv.text(when(c.start) + (tr.current ? '  ·  driving' : '  to  ' + when(c.end)), W - 40, 50, 18, t.dim, { align: 'right', literal: true });
                if (!c) { cv.text('Drive Log starts with the car and records each drive by itself.', 40, 100, 22, t.dim, L); return; }
                const adj = cal.adjusted(c.best060);
                const tiles = [
                    ['DISTANCE', dist(c.km)], ['MOVING', dur(c.movingMs)], ['TOP SPEED', spd(c.topKmh)],
                    ['BEST 0-60', secs(c.best060), adj !== null ? 'Dragy-adjusted ' + secs(adj) : ''], ['PEAK RPM', c.peakRpm ? Math.round(c.peakRpm) + '' : '-'],
                    ['ACCEL', g(c.maxAccelG)], ['BRAKING', g(c.maxBrakeG)], ['CORNERING', g(c.maxLatG)],
                    ['OIL MAX', temp(c.oilMax)], ['COOLANT MAX', temp(c.coolantMax)],
                ];
                const cw = (W - 80) / 5;
                tiles.forEach((x, i) => {
                    const cx = 40 + (i % 5) * cw, cy = 90 + Math.floor(i / 5) * 190;
                    cv.roundRect(cx + 6, cy, cw - 12, 170, 16, t.panelTop || '#17181c');
                    cv.text(x[0], cx + cw / 2, cy + 44, 16, t.dim, { font: 'bold', align: 'center', literal: true });
                    cv.text(x[1], cx + cw / 2, cy + 112, 40, t.text, { font: 'bold', align: 'center', literal: true });
                    if (x[2]) cv.text(x[2], cx + cw / 2, cy + 150, 16, t.accent2 || t.dim, { align: 'center', literal: true });
                });
                const best = tr.best060();
                if (best !== null) cv.text('All-time best 0-60: ' + secs(best) + (cal.adjusted(best) !== null ? ' (Dragy-adjusted ' + secs(cal.adjusted(best)) + ')' : ' (car speed, not GPS)'), 40, H - 14, 16, t.dim, L);
            }
            function drawList(cv, t, L, title, sub, rows, empty) {
                cv.text(title, 40, 50, 30, t.text, { font: 'bold', literal: true });
                cv.text(sub, W - 40, 50, 18, t.dim, { align: 'right', literal: true });
                const pages = Math.max(1, Math.ceil(rows.length / ROWS)), pg = page % pages;
                if (!rows.length) cv.text(empty, 40, 100, 22, t.dim, L);
                rows.slice(pg * ROWS, pg * ROWS + ROWS).forEach((r, i) => {
                    const y = 100 + i * 52;
                    cv.text(r[0], 40, y + 20, 22, t.text, L);
                    cv.text(r[1], 300, y + 20, 22, t.dim, L);
                });
                if (pages > 1) cv.text('Page ' + (pg + 1) + ' of ' + pages + ' (More)', W - 40, H - 14, 16, t.dim, { align: 'right', literal: true });
            }

            ctx.loop('MAIN', 4, guard('draw', async () => {
                const t = ctx.theme(), cv = ctx.canvas(W, H).clear(t.bg), L = { literal: true };
                if (entry) drawEntry(cv, t, L);
                else if (view === 'drive') drawDrive(cv, t, L);
                else if (view === 'history') {
                    drawList(cv, t, L, 'History', tr.trips.length + ' drives kept', tr.trips.slice().reverse().map((c) => [when(c.start),
                        dist(c.km) + '   ' + dur(c.movingMs) + '   top ' + spd(c.topKmh) + '   0-60 ' + secs(c.best060) + '   oil ' + temp(c.oilMax)]), 'Finished drives show up here.');
                } else {
                    const s = cal.stats();
                    const sub = s.n ? (s.ready ? 'Offset ' + (s.offset > 0 ? '+' : '') + s.offset.toFixed(2) + ' s, typically within ' + s.spread.toFixed(2) + ' s (' + s.n + ' runs)' : s.n + ' of ' + READY_N + ' runs with a Dragy time') : (dragyOn() ? 'No Dragy times yet' : 'Turn on Compare with Dragy in Settings');
                    drawList(cv, t, L, '0-60 runs', sub, cal.runs.slice().reverse().map((r) => [when(r.at),
                        'car ' + secs(r.car) + (r.dragy !== null ? '   Dragy ' + secs(r.dragy) + '   diff ' + (r.dragy - r.car >= 0 ? '+' : '') + (r.dragy - r.car).toFixed(2) : r.skipped ? '   no Dragy time' : '') + (cal.adjusted(r.car) !== null ? '   adjusted ' + secs(cal.adjusted(r.car)) : '')]), 'Timed 0-60 runs show up here.');
                }
                if (dragyOn() && !entry && cal.pending()) cv.text('A run is waiting for its Dragy time: Enter Dragy time', W / 2, H - 40, 18, t.accent2 || t.text, { align: 'center', literal: true });
                if (toast && Date.now() < toast.until) {
                    const w = cv.textWidth(toast.text, 22, L) + 60;
                    cv.roundRect((W - w) / 2, H - 66, w, 46, 23, '#2a2b31');
                    cv.text(toast.text, W / 2, H - 36, 22, '#ffffff', { align: 'center', literal: true });
                }
                await ui.image('MAIN_GFX', cv);
            }));
            /* ---------- home-screen widget: this drive, or the last one ---------- */
            HW.start(ctx, () => {
                const c = tr.current || tr.trips[tr.trips.length - 1];
                if (!c) return { label: 'Drive Log', value: 'No drives yet', sub: 'Records each drive by itself', small: ['Drive Log', 'No drives yet'] };
                const b = c.best060, adj = cal.adjusted(b);
                const run = b === null ? '' : '0-60 ' + (adj !== null ? secs(adj) + ' (Dragy-adj.)' : secs(b));
                return { label: tr.current ? 'This drive' : 'Last drive', value: dist(c.km),
                    sub: 'top ' + spd(c.topKmh) + '   ' + dur(c.movingMs), sub2: run || ('oil max ' + temp(c.oilMax)),
                    small: [(tr.current ? 'This drive: ' : 'Last drive: ') + dist(c.km), run || 'top ' + spd(c.topKmh)] };
            });
            log.info('started ' + VERSION + ' (' + tr.trips.length + ' drives, ' + cal.runs.length + ' runs kept)');
        } catch (e) {
            log.error('start: ' + (e && e.stack || e));
        }
    },
});
