'use strict';
/**
 * Track Mode - a lap timer drawn in the HMI's style.
 *
 *   Press Lap at the start/finish line: the first press starts timing, each next press
 *   closes a lap and opens the next. Sector splits a lap without closing it. Best lap,
 *   best sector per index and the theoretical best (sum of best sectors) are kept, and
 *   the laps list shows every lap with its delta to the best.
 *
 * The MGU exposes no GPS position over SOME/IP (these apps read speed and acceleration,
 * not latitude/longitude), so laps are marked by hand. Speed comes from
 * Vehicle2.statusCarSpeed2 (centre-of-gravity speed, BMW scaling); it drives max/avg
 * speed per lap and, with "Start first lap on movement", an automatic start.
 *
 * Pages: live lap  /  laps + best (saved in data/track_laps.json).
 */
const fs = require('fs');
const path = require('path');
const mgu = require('./kit/mgu');
const { withAlpha } = require('./kit/canvas');
const G = require('./kit/gauges');
const { LapTimer } = require('./lap');
const Demo = require('./demo');

const W = 1600, H = 520;
const MPH = 1.609344;
const GO = '#2fd27a';
const START_KMH = 5;                 // movement that auto-starts the first lap
const MAX_SECTOR_ROWS = 5;

mgu.run({
    async start(ctx) {
        const { ui, settings, log } = ctx;
        const S = (ctx.spec.config && ctx.spec.config.scaling) || {};
        const sc = (k, raw) => {
            const c = S[k];
            if (!c || raw === undefined || raw === null || raw === c.invalid) return null;
            return raw * c.factor + (c.offset || 0);
        };

        /* ---------- saved laps ---------- */
        const FILE = path.join(ctx.dataDir, 'track_laps.json');
        const liveTimer = new LapTimer({ onLap: () => save() });
        try {
            const s = JSON.parse(fs.readFileSync(FILE, 'utf8'));
            liveTimer.laps = Array.isArray(s.laps) ? s.laps : [];
            liveTimer.best = s.best || null;
            liveTimer.bestSectors = Array.isArray(s.bestSectors) ? s.bestSectors : [];
            liveTimer.lapCount = s.lapCount || 0;
        } catch (e) { /* first start */ }
        const demoTimer = new LapTimer({});
        let timer = liveTimer;
        const save = () => {
            if (timer !== liveTimer) return;                 // demo laps are shown but never saved
            try {
                fs.writeFileSync(FILE, JSON.stringify({
                    laps: liveTimer.laps.slice(0, 50), best: liveTimer.best,
                    bestSectors: liveTimer.bestSectors, lapCount: liveTimer.lapCount,
                }));
            } catch (e) { log.warn('save laps: ' + e); }
        };

        /* ---------- live data ---------- */
        const live = { speed: null };
        let lastCar = 0, feedDemo = false, speedSub = null;
        const demo = new Demo(), t0 = Date.now();
        const carPresent = () => lastCar > 0 || !!(speedSub && speedSub.available);
        const usingDemo = () => settings.get('demo') === 'on'
            || (settings.get('demo') === 'auto' && !carPresent() && Date.now() - t0 > 5000);

        const maybeAutoStart = (now) => {
            if (timer === liveTimer && !timer.running && settings.get('autoStart')
                && live.speed != null && live.speed > START_KMH) {
                timer.lap(now);                              // first lap(): starts timing, records nothing
                log.info('auto-started on movement');
            }
        };

        ctx.signals.watch('de.bmw.infotainment.vehicle.Vehicle2', '1', {
            statusCarSpeed2: (v) => {
                const kmh = sc('speed', v.speedVehicleCentreOfGravity);
                if (kmh === null) return;
                lastCar = Date.now();
                live.speed = kmh;
                if (!feedDemo) { timer.feed(lastCar, kmh); maybeAutoStart(lastCar); }
            },
        }, log).then((s) => { speedSub = s; log.info('speed signal ' + (s.error ? 'error ' + s.error : 'subscribed')); return s; });

        // demo feed at 20 Hz; it drives the demo timer's laps and sectors itself
        setInterval(() => {
            const d = usingDemo();
            if (d !== feedDemo) {
                feedDemo = d;
                timer = d ? demoTimer : liveTimer;
                if (d) { demoTimer.reset(); demo.t0 = null; }
                log.info(d ? 'demo data on' : 'live speed');
            }
            if (!feedDemo) return;
            const now = Date.now();
            live.speed = demo.speed(now);
            timer.feed(now, live.speed);
            const due = demo.due(now);
            if (due.lap) timer.lap(now);
            else if (due.sector) timer.sector(now);
        }, 50);

        /* ---------- units / format ---------- */
        const mph = () => settings.get('speedUnit') === 'mph';
        const V = (k) => (k == null ? null : mph() ? k / MPH : k);
        const vU = () => (mph() ? 'mph' : 'km/h');
        const lapTime = (s) => {
            if (!G.isNum(s)) return '--.--';
            const m = Math.floor(s / 60), ss = s - m * 60;
            return m > 0 ? m + ':' + (ss < 10 ? '0' : '') + ss.toFixed(2) : ss.toFixed(2);
        };
        const sTime = (s) => (G.isNum(s) ? s.toFixed(2) : '--.--');
        const dStr = (d) => (d == null ? '' : (d <= 0 ? '' : '+') + d.toFixed(2));
        const when = (ms) => { const d = new Date(ms); const p = (n) => String(n).padStart(2, '0'); return p(d.getHours()) + ':' + p(d.getMinutes()); };

        /* ---------- drawing ---------- */
        let page = 0;

        function header(cv, t) {
            G.frame(cv, t, ['Live', 'Laps'], page, [feedDemo && { text: 'DEMO' }]);
        }

        function drawLive(cv, t) {
            const now = Date.now();
            const running = timer.running;
            const el = timer.elapsed(now);
            const last = timer.laps[0] || null;
            const best = timer.best;

            // --- current lap clock ---
            G.panel(cv, t, 24, 44, 508, 468, 'Current lap');
            cv.text('LAP ' + (timer.lapCount + 1), 508, 92, 24, t.dim, { align: 'right', font: 'bold', spacing: 1 });
            cv.text(lapTime(el), 280, 250, 104, running ? t.text : t.dim, { align: 'center', font: 'num' });
            const stateTxt = running ? 'TIMING' : (timer.laps.length ? 'PRESS LAP FOR NEXT RUN' : 'PRESS LAP TO START');
            const stateCol = running ? t.accent2 : GO;
            cv.roundRect(44, 300, 468, 46, 8, withAlpha(stateCol, running ? 0.16 : 0.30 + 0.22 * Math.sin(now / 160)));
            cv.text(stateTxt, 278, 331, 24, running ? t.accent2 : GO, { align: 'center', font: 'bold', spacing: 2 });
            // current sector + live speed
            const sn = timer.sectors.length + 1;
            cv.text(running ? 'Sector ' + sn + ' · ' + sTime(timer.sectorElapsed(now)) + ' s' : 'Sector —',
                48, 392, 22, t.dim, { font: 'label' });
            const sp = V(G.hold('spd', live.speed, 120));
            cv.text(G.isNum(sp) ? G.fmt(sp, 0) + ' ' + vU() : '— ' + vU(), 508, 392, 22, t.dim, { align: 'right', font: 'label' });
            G.button(cv, t, 48, 452, 210, 44, 'Sector', actSector, { key: 'sector', color: running ? null : withAlpha(t.text, 0.25) });
            G.button(cv, t, 298, 452, 210, 44, resetArmed ? 'Yes, reset' : 'Reset', actReset, { key: 'reset', color: resetArmed ? t.crit : null });

            // --- sectors of the current lap ---
            G.panel(cv, t, 556, 44, 508, 468, 'Sectors');
            const sectors = timer.sectors.slice();
            if (running) sectors.push(null);                 // the in-progress sector
            if (!sectors.length) {
                cv.text('Sector splits show here as you press Sector.', 810, 280, 24, t.dim, { align: 'center' });
            }
            sectors.slice(0, MAX_SECTOR_ROWS).forEach((s, i) => {
                const y = 112 + i * 74;
                const inProg = s === null;
                const bestS = timer.bestSectors[i];
                cv.text('S' + (i + 1), 580, y + 30, 28, t.text, { font: 'bold' });
                const val = inProg ? timer.sectorElapsed(now) : s;
                cv.text(sTime(val), 940, y + 38, 40, inProg ? t.dim : t.text, { align: 'right', font: 'num' });
                cv.text('s', 948, y + 38, 20, t.dim);
                let sub = bestS != null ? 'best ' + sTime(bestS) : 'no best yet', subCol = t.dim;
                if (!inProg && bestS != null) {
                    const d = s - bestS;
                    if (d <= 1e-9) { sub = 'SECTOR BEST'; subCol = GO; }
                    else { sub = '+' + d.toFixed(2) + '  vs best ' + sTime(bestS); subCol = t.dim; }
                }
                cv.text(sub, 1044, y + 38, 22, subCol, { align: 'right', font: 'label' });
                if (i < Math.min(sectors.length, MAX_SECTOR_ROWS) - 1) cv.fillRect(580, y + 54, 460, 1, withAlpha(t.tick, 0.35));
            });

            // --- this lap / best ---
            G.panel(cv, t, 1088, 44, 488, 468, 'Last · best');
            const rows = [
                ['Last lap', last ? lapTime(last.time) : '--.--', last && last.delta != null ? dStr(last.delta) : '', last && last.delta != null && last.delta <= 0 ? GO : t.dim],
                ['Best lap', best ? lapTime(best.time) : '--.--', best ? '#' + best.n : '', t.accent2],
                ['Optimal', lapTime(timer.optimal()), 'best sectors', t.dim],
            ];
            rows.forEach((r, i) => {
                const y = 108 + i * 104;
                cv.text(r[0], 1112, y + 24, 24, t.dim, { font: 'bold', spacing: 0.5 });
                cv.text(r[1], 1552, y + 52, 52, i === 1 ? t.accent2 : t.text, { align: 'right', font: 'num' });
                if (r[2]) cv.text(r[2], 1112, y + 54, 22, r[3], { font: 'label' });
                if (i < rows.length - 1) cv.fillRect(1112, y + 72, 440, 1, withAlpha(t.tick, 0.35));
            });
            if (last) cv.text('max ' + Math.round(V(last.maxSpeed)) + ' · avg ' + Math.round(V(last.avgSpeed)) + ' ' + vU(),
                1112, 492, 22, t.dim, { font: 'label' });
        }

        function drawLaps(cv, t) {
            const sh = G.panel(cv, t, 24, 44, 1552, 468, 'Laps'), ex = Math.max(0, sh.y + sh.h - G.BOTTOM);
            G.button(cv, t, 1552 - 20 - 220, 56, 220, 40, resetArmed ? 'Yes, clear all' : 'Clear laps', actReset, { key: 'clearall', color: resetArmed ? t.crit : null });
            const laps = timer.laps;
            cv.text('LAP', 48, 128, 22, t.dim, { font: 'bold', spacing: 1 });
            cv.text('TIME', 360, 128, 22, t.dim, { align: 'right', font: 'bold', spacing: 1 });
            cv.text('SECTORS', 420, 128, 22, t.dim, { font: 'bold', spacing: 1 });
            cv.text('Δ BEST', 1300, 128, 22, t.dim, { align: 'right', font: 'bold', spacing: 1 });
            cv.text('MAX', 1540, 128, 22, t.dim, { align: 'right', font: 'bold', spacing: 1 });
            if (!laps.length) {
                cv.text('No laps yet — press Lap at the line to start, and again each time round.', 48, 210, 26, t.dim);
            }
            const shown = laps.slice(0, 8 + Math.floor(ex / 44));
            shown.forEach((r, i) => {
                const y = 170 + i * 44;
                const isBest = timer.best && r.n === timer.best.n;
                cv.text('#' + r.n, 48, y, 26, isBest ? GO : t.text, { font: 'bold' });
                cv.text(lapTime(r.time), 360, y, 30, isBest ? GO : t.text, { align: 'right', font: 'num' });
                (r.sectors || []).slice(0, 6).forEach((s, j) => {
                    cv.text(sTime(s), 500 + j * 150, y, 24, t.dim, { align: 'right', font: 'num' });
                });
                if (r.delta != null) cv.text(dStr(r.delta) || '0.00', 1300, y, 26, r.delta <= 0 ? GO : t.dim, { align: 'right', font: 'num' });
                cv.text(G.isNum(r.maxSpeed) ? String(Math.round(V(r.maxSpeed))) : '-', 1540, y, 24, t.dim, { align: 'right', font: 'num' });
                if (i < shown.length - 1) cv.fillRect(48, y + 12, 1504, 1, withAlpha(t.tick, 0.25));
            });
            const opt = timer.optimal();
            if (G.isNum(opt)) cv.text('Theoretical best from best sectors:  ' + lapTime(opt), 48, sh.y + sh.h - 20, 22, t.accent2, { font: 'label' });
        }

        async function render() {
            const t = ctx.theme();
            const cv = ctx.canvas(W, H).clear(t.bg);
            (page === 0 ? drawLive : drawLaps)(cv, t);
            header(cv, t);
            await ui.image('MAIN_GFX', cv);
        }

        /* ---------- buttons ---------- */
        let resetArmed = null;
        const disarm = () => { if (resetArmed) { clearTimeout(resetArmed); resetArmed = null; } };

        function actLap() {
            disarm();
            timer.lap(Date.now());
            return render();
        }
        function actSector() {
            disarm();
            if (timer.running) timer.sector(Date.now());
            return render();
        }
        function actReset() {
            if (!resetArmed) { resetArmed = setTimeout(() => { resetArmed = null; render(); }, 5000); return render(); }
            disarm();
            timer.reset();
            save();
            log.info('laps reset');
            return render();
        }

        const flip = () => { page = 1 - page; disarm(); return render(); };
        ui.onClick('BTN_ACTION', actLap);
        ui.onClick('BTN_PAGE', flip);
        ui.onClick('BTN_PREV', flip);
        ctx.onTab((i) => i !== page && flip());
        ctx.hideButton('BTN_ACTION');

        ctx.loop('MAIN', 8, render);
        render().then(() => log.info('first frame done')).catch((e) => log.warn('first render: ' + e));
    },
});
