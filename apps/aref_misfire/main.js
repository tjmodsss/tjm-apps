'use strict';
/**
 * Misfire Watch: logs every misfire the engine counts, per cylinder, across every drive, with what the
 * car was doing at that moment (rpm, speed, gear, load, coolant and oil temperature, drive mode).
 *
 * The engine unit (DME, 0x12) keeps a misfire counter per cylinder for the drive (OBD service 06, the
 * standard on-board monitor results: MID A2..A7 = cylinder 1..6, TID 0C = this driving cycle, TID 0B = an
 * average over the last 10). The counter starts again at every engine start, so a count seen once a drive
 * shows a total, not when the misfires happened. This app reads it every few seconds while the engine
 * runs and logs each rise (misfire/track.js): which cylinder, how many, when, and under what conditions,
 * kept across drives. That is what finds a weak coil or a worn plug: misfires that keep landing on one
 * cylinder, under load, at high rpm.
 *
 * Read-only: it sends only OBD service 06 requests (or the UDS form 22 F6xx where an engine wants it),
 * the same as M Vitals. It clears nothing and writes nothing to the car. Starts with the car.
 *
 * Node 8 only (the car's version). Nothing may throw out of a callback: every callback goes through guard().
 */
const fs = require('fs');
const path = require('path');
const mgu = require('./kit/mgu');
const Car = require('./kit/car');
const { Diag } = require('./kit/diag');
const { DidReader } = require('./dids');
const T = require('./track');
const HW = require('./kit/homewidget');

const VERSION = '0.1.1';
const W = 1600, H = 520;
const DME = 0x12;                  // the engine unit
const MID0 = 0xA2;                 // misfire monitor of cylinder 1 (A3 = 2 ...)
const TID_DRIVE = 0x0C, TID_AVG = 0x0B;
const FIRST_READ_MS = 20000;       // after the app starts: let the units settle after waking
const IDLE_CHECK_MS = 15000;       // no engine speed from the car yet: try this often
const SAVE_MS = 60000;             // the log is saved at least this often while it changes
const ROWS = 7;
const COL = { ok: '#2fd27a', few: '#ffb31a', many: '#ff3b30' };

mgu.run({
    async start(ctx) {
        const { ui, settings, log } = ctx;
        const guard = (name, fn) => function () {
            try { return fn.apply(this, arguments); } catch (e) { log.error('error in ' + name + ': ' + (e && e.stack || e)); return undefined; }
        };
        try {
            const FILE = path.join(ctx.dataDir, 'misfires.json'), CSV = path.join(ctx.dataDir, 'misfires.csv');
            let saved = null;
            try { saved = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { /* first run */ }
            const tr = new T.Tracker(saved);
            let dirty = false;
            const save = () => {
                if (!dirty) return;
                try { fs.writeFileSync(FILE, JSON.stringify(tr.state)); fs.writeFileSync(CSV, T.csv(tr.state.events)); dirty = false; } catch (e) { log.warn('save: ' + e.message); }
            };
            setInterval(guard('save', save), SAVE_MS);

            const car = new Car(ctx, ['rpm', 'speed', 'temps', 'gear', 'torque', 'drivemode'], { demo: false });
            const diag = new Diag(ctx.signals, log);
            diag.quiet = true; diag.busyLog = false;
            await diag.init();
            const rd = new DidReader(diag, { ecu: DME });

            const every = () => (Number(settings.get('every')) || 4) * 1000;
            const alertAt = () => Number(settings.get('alert')) || 10;
            const us = () => (settings.get('units') || 'us') !== 'metric';
            let status = 'Waiting for the engine', busy = false, mode = null, cyl = 0, nextAt = Date.now() + FIRST_READ_MS;
            let alert = null;             // { text, until } the banner after misfires

            /*
             * The counts per cylinder for this drive and the 10-drive averages, or null. mode: which request
             * this engine answers (false = service 06, true = UDS 22 F6xx, null = not found yet); cyl: how many
             * cylinders it has misfire monitors for (from MID A0's list, or counted).
             */
            async function readCounts() {
                if (mode === null) {
                    if (await rd.monitor(DME, MID0, false)) mode = false;
                    else if (await rd.monitor(DME, MID0, true)) mode = true;
                    else return null;
                    log.info('misfire counters: ' + (mode ? 'UDS 22 F6xx' : 'OBD service 06'));
                }
                if (!cyl) {
                    const sup = await rd.supported(DME, 0xA0, mode);
                    let n = 0;
                    while (sup && n < 12 && sup.indexOf(MID0 + n) >= 0) n++;
                    if (n) { cyl = n; log.info('misfire counters: ' + n + ' cylinders'); }
                }
                const counts = [], avg = [];
                for (let c = 0; c < (cyl || 12); c++) {
                    const res = await rd.monitor(DME, MID0 + c, mode);
                    if (!res) {
                        // counting without the list: a refusal past cylinder 1 ends the engine, a missed reply doesn't
                        if (cyl || !c || !/^NRC/.test(rd.raws[rd.monitorKey(DME, MID0 + c, mode)].why)) return null;
                        break;
                    }
                    const d = res.find((x) => x.tid === TID_DRIVE), a = res.find((x) => x.tid === TID_AVG);
                    counts.push(d && d.value < 65535 ? d.value : null);
                    avg.push(a && a.value < 65535 ? a.value : null);
                }
                if (!cyl) { cyl = counts.length; log.info('misfire counters: ' + cyl + ' cylinders (counted)'); }
                return counts.length === cyl ? { counts: counts, avg: avg } : null;
            }

            const ctxNow = () => {
                const d = car.data() || {}, c = {};
                ['rpm', 'speed', 'coolant', 'oil', 'torque'].forEach((k) => { if (isFinite(d[k])) c[k] = Math.round(d[k]); });
                if (d.gear !== undefined && d.gear !== null) c.gear = d.gear;
                if (d.stage) c.stage = d.stage;
                if (d.driveMode) c.mode = d.driveMode;
                return c;
            };
            const running = () => { const r = (car.data() || {}).rpm; return isFinite(r) ? r > 300 : null; };

            async function poll() {
                if (busy) return;
                const run = running();
                if (run === false) { status = 'Engine off'; nextAt = Date.now() + 5000; return; }
                if (!diag.p) { status = 'No diagnostic link: ' + (diag.error || 'not ready'); nextAt = Date.now() + IDLE_CHECK_MS; return; }
                busy = true;
                try {
                    const r = await readCounts();
                    if (!r) { status = 'The engine unit didn\'t answer (' + (rd.raws[rd.monitorKey(DME, MID0, !!mode)] || {}).why + ')'; return; }
                    const ev = tr.feed(r.counts, Date.now(), ctxNow(), r.avg);
                    if (ev.length) {
                        dirty = true;
                        ev.forEach((e) => log.info('misfire: cylinder ' + e.cyl + ' x' + e.n + (e.early ? ' (before the first reading)' : '') + ' at ' + ctxText(e.ctx)));
                        const n = tr.driveTotal();
                        if (n >= alertAt()) alert = { text: n + ' misfires this drive, most on cylinder ' + tr.worst(tr.state.drive.counts), until: Date.now() + 15000 };
                        save();
                    }
                    status = 'Reading every ' + every() / 1000 + ' s';
                } catch (e) {
                    status = 'Read failed: ' + e.message;
                    log.warn('poll: ' + e);
                } finally {
                    busy = false;
                    nextAt = Date.now() + (running() === null ? IDLE_CHECK_MS : every());
                }
            }
            setInterval(guard('timer', () => { if (Date.now() >= nextAt && !busy) poll(); }), 1000);

            /* ---------- text ---------- */
            const clock = (t) => { const d = new Date(t); return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0'); };
            const ago = (t) => { const s = Math.round((Date.now() - t) / 1000); return s < 60 ? 'just now' : s < 3600 ? Math.round(s / 60) + ' min ago' : s < 86400 ? Math.round(s / 3600) + ' h ago' : clock(t); };
            function ctxText(c) {
                c = c || {};
                const p = [];
                if (c.rpm !== undefined) p.push(c.rpm + ' rpm');
                if (c.speed !== undefined) p.push(c.speed < 2 ? 'stopped' : us() ? Math.round(c.speed * 0.621371) + ' mph' : c.speed + ' km/h');
                if (c.stage === 'P') p.push('in P'); else if (c.gear > 0) p.push('gear ' + c.gear);
                if (c.torque !== undefined) p.push(us() ? Math.round(c.torque * 0.737562) + ' lb-ft' : c.torque + ' Nm');
                if (c.coolant !== undefined) p.push('coolant ' + (us() ? Math.round(c.coolant * 1.8 + 32) + ' F' : c.coolant + ' C'));
                if (c.mode) p.push(c.mode);
                return p.join(', ') || 'no drive data';
            }
            const fit = (cv, s, size, w, opt) => {
                s = String(s || '');
                if (cv.textWidth(s, size, opt) <= w) return s;
                while (s.length > 1 && cv.textWidth(s + '...', size, opt) > w) s = s.slice(0, -1);
                return s + '...';
            };

            /* ---------- buttons ---------- */
            let view = 'overview', page = 0;
            const VIEWS = ['overview', 'log', 'drives'], NEXT = { overview: 'Misfire log', log: 'Drives', drives: 'Overview' };
            ui.onClick('BTN_VIEW', guard('view', () => { view = VIEWS[(VIEWS.indexOf(view) + 1) % VIEWS.length]; page = 0; ui.text('BTN_VIEW', NEXT[view]); }));
            ui.onClick('BTN_MORE', guard('more', () => { page++; }));
            ui.onClick('BTN_SAVE', guard('export', () => {
                dirty = true; save();
                alert = { text: 'Saved ' + tr.state.events.length + ' misfires to ' + CSV, until: Date.now() + 6000 };
            }));

            /* ---------- drawing ---------- */
            function drawOverview(cv, t) {
                const S = tr.state, d = S.drive, n = cyl || (S.last ? S.last.counts.length : 6) || 6, now = d ? d.counts : [];
                const total = T.sum(now), sev = T.severity(total, alertAt());
                cv.text('This drive', 40, 50, 30, t.text, { font: 'bold', literal: true });
                cv.text(String(total), 40, 150, 84, COL[sev], { font: 'bold', literal: true });
                cv.text(total === 1 ? 'misfire' : 'misfires', 40, 182, 22, t.dim, { literal: true });
                // one column per cylinder: this drive (bar and number), all time, the engine unit's 10-drive average
                const x0 = 300, cw = Math.min(190, (W - x0 - 40) / n), top = 96, bh = 230;
                const peak = Math.max(5, Math.max.apply(null, now.concat([0])));
                for (let i = 0; i < n; i++) {
                    const x = x0 + i * cw, v = now[i] || 0, all = S.totals[i] || 0, avg = S.avg10 ? S.avg10[i] : null;
                    const h = v ? Math.max(6, Math.round(bh * v / peak)) : 0, c = COL[T.severity(v, Math.max(3, Math.ceil(alertAt() / 2)))];
                    cv.roundRect(x + 14, top, cw - 28, bh, 10, t.track || '#ffffff14');
                    if (h) cv.roundRect(x + 14, top + bh - h, cw - 28, h, 10, c);
                    cv.text(String(v), x + cw / 2, top + bh - h - 10 > top + 30 ? top + bh - h - 12 : top + 34, 30, v ? t.text : t.dim, { font: 'bold', align: 'center', literal: true });
                    cv.text('CYL ' + (i + 1), x + cw / 2, top + bh + 30, 18, t.text, { font: 'bold', align: 'center', literal: true });
                    cv.text(all + ' all time', x + cw / 2, top + bh + 54, 15, all ? t.text : t.dim, { align: 'center', literal: true });
                    if (avg !== null && avg !== undefined) cv.text('DME avg ' + avg, x + cw / 2, top + bh + 74, 15, t.dim, { align: 'center', literal: true });
                }
                const e = S.events[S.events.length - 1], L = { literal: true };
                cv.text(e ? 'Last: cylinder ' + e.cyl + ' x' + e.n + ', ' + ago(e.at) : 'No misfires logged yet', 40, 236, 20, e ? t.text : t.dim, { font: 'bold', literal: true });
                if (e) cv.text(fit(cv, (e.early ? 'before the first reading; ' : '') + ctxText(e.ctx), 16, 250, L), 40, 260, 16, t.dim, L);
                const worst = tr.worst();
                if (worst) cv.text(fit(cv, 'Most: cylinder ' + worst + ' (' + S.totals[worst - 1] + ' of ' + T.sum(S.totals) + ')', 16, 250, L), 40, 290, 16, t.dim, L);
                cv.text(fit(cv, status + '  ·  ' + S.reads + ' readings over ' + (S.drives.length + (d ? 1 : 0)) + ' drives  ·  DME avg: the engine unit\'s own average of the last 10 drives', 15, W - 80, L), 40, H - 22, 15, t.dim, L);
            }
            function rowsOf(t) {
                if (view === 'log') {
                    const r = tr.state.events.slice().reverse().map((e) => ({ badge: ['CYL ' + e.cyl + '  x' + e.n, e.n >= 3 ? COL.many : COL.few], a: clock(e.at) + '  ·  drive ' + e.drive + (e.early ? '  ·  before the first reading' : ''), b: ctxText(e.ctx) }));
                    return r.length ? r : [{ a: 'No misfires logged yet.', b: 'Every misfire the engine counts lands here, with the conditions at that moment.' }];
                }
                const all = tr.recentDrives(1000).slice().reverse();
                const r = all.map((d) => {
                    const n = T.sum(d.counts), mins = Math.max(0, Math.round((d.end - d.start) / 60000));
                    return { badge: [n ? n + ' misfire' + (n === 1 ? '' : 's') : 'CLEAN', COL[T.severity(n, alertAt())]], a: 'Drive ' + d.id + '  ·  ' + clock(d.start) + '  ·  ' + mins + ' min' + (d === tr.state.drive ? '  ·  now' : ''), b: 'Per cylinder: ' + d.counts.map((c, i) => (i + 1) + ': ' + c).join('   ') };
                });
                return r.length ? r : [{ a: 'No drives yet.', b: '' }];
            }
            ctx.loop('MAIN', 2, guard('draw', async () => {
                const t = ctx.theme(), cv = ctx.canvas(W, H).clear(t.bg), L = { literal: true };
                if (view === 'overview') drawOverview(cv, t);
                else {
                    cv.text(view === 'log' ? 'Misfire log' : 'Drives', 40, 50, 30, t.text, { font: 'bold', literal: true });
                    cv.text(fit(cv, status, 18, 700, L), W - 40, 50, 18, t.dim, { align: 'right', literal: true });
                    const rows = rowsOf(t), pages = Math.max(1, Math.ceil(rows.length / ROWS)), pg = page % pages;
                    rows.slice(pg * ROWS, pg * ROWS + ROWS).forEach((r, i) => {
                        const y = 100 + i * 58;
                        let x = 40;
                        if (r.badge) {
                            const bw = cv.textWidth(r.badge[0], 14, { font: 'bold', literal: true }) + 20;
                            cv.roundRect(x, y - 2, bw, 24, 12, r.badge[1]);
                            cv.text(r.badge[0], x + bw / 2, y + 15, 14, '#000000', { font: 'bold', align: 'center', literal: true });
                            x += bw + 14;
                        }
                        cv.text(fit(cv, r.a, 22, W - x - 40, L), x, y + 17, 22, t.text, L);
                        if (r.b) cv.text(fit(cv, r.b, 17, W - 80, L), 40, y + 44, 17, t.dim, L);
                    });
                    if (pages > 1) cv.text('Page ' + (pg + 1) + ' of ' + pages + ' (More)', W - 40, H - 14, 16, t.dim, { align: 'right', literal: true });
                }
                if (alert && Date.now() < alert.until) {
                    const s = fit(cv, alert.text, 22, 1100, L), w = cv.textWidth(s, 22, L) + 60;
                    cv.roundRect((W - w) / 2, H - 70, w, 50, 25, COL.many);
                    cv.text(s, W / 2, H - 37, 22, '#000000', { align: 'center', font: 'bold', literal: true });
                }
                await ui.image('MAIN_GFX', cv);
            }));

            /* ---------- home-screen widget: this drive's count, and the last misfire ---------- */
            HW.start(ctx, () => {
                const n = tr.driveTotal(), e = tr.state.events[tr.state.events.length - 1], sev = T.severity(n, alertAt());
                const last = e ? 'Last: cyl ' + e.cyl + ' x' + e.n + ', ' + ago(e.at) : 'None logged yet';
                return { label: 'Misfire Watch', value: n ? n + ' this drive' : 'None this drive',
                    sub: n ? 'Most on cylinder ' + tr.worst(tr.state.drive.counts) : 'All cylinders clean', sub2: last,
                    tone: sev === 'many' ? 'crit' : sev === 'few' ? 'warn' : 'ok', small: [n ? n + ' misfires this drive' : 'No misfires this drive', last] };
            });
            // 0.1.1: Car Watch replaces this app. A copy of the data for Car Watch to bring over on its first start
            // (/dev/shm: memory only, gone at the next head-unit restart, so install Car Watch before that).
            const handoff = guard('handoff', () => {
                const dir = '/dev/shm/aref-handoff-' + ctx.spec.id;
                try { fs.mkdirSync(dir, 0o755); } catch (e) { /* there already */ }
                ['misfires.json',  'misfires.csv'].forEach((f) => {
                    try { fs.writeFileSync(path.join(dir, f), fs.readFileSync(path.join(ctx.dataDir, f)), { mode: 0o644 }); fs.chmodSync(path.join(dir, f), 0o644); } catch (e) { /* not written yet */ }
                });
            });
            handoff();
            setInterval(handoff, 60000);
            log.info('started ' + VERSION + ' (' + tr.state.events.length + ' misfires, ' + tr.state.drives.length + ' drives kept)');
        } catch (e) {
            log.error('start: ' + (e && e.stack || e));
        }
    },
});
