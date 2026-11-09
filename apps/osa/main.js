'use strict';

/**
 * Oil Service Assistant
 *
 * Engine oil temperature comes from BMW's native CDS vehicle signal.
 * Transmission oil temperature is read from the verified EGS variant using
 * the shared read-only diagnostic transport.
 */
const mgu = require('./kit/mgu');
const G = require('./kit/gauges');
const Car = require('./kit/car');
const { withAlpha } = require('./kit/canvas');
const TransmissionReader = require('./transmission');
const fs = require('fs');
const path = require('path');
const { decode: decodePng } = require('./png');

const W = 1600, H = 520;

mgu.run({
    async start(ctx) {
        const { ui, log } = ctx;
        let page = 0;
        // PNGs are decoded to pixels, then converted to native drawing commands.
        // The native mgu-render/1 transport does not support pixel-image uploads.
        const rasterLayer = (key, src) => G.layer(key, src.w, src.h, (c) => {
            const d = src.d, w = src.w, h = src.h;
            for (let y = 0; y < h; y++) {
                let run = -1, last = -1;
                for (let x = 0; x <= w; x++) {
                    let color = -1;
                    if (x < w) {
                        const p = (y * w + x) * 4;
                        const a = Math.round(d[p + 3] / 17) * 17;
                        if (a >= 32) {
                            const r = Math.round(d[p] / 17) * 17;
                            const g = Math.round(d[p + 1] / 17) * 17;
                            const b = Math.round(d[p + 2] / 17) * 17;
                            color = (((r & 255) << 24) | ((g & 255) << 16) | ((b & 255) << 8) | (a & 255)) >>> 0;
                        }
                    }
                    if (color !== last) {
                        if (last !== -1) c.fillRect(run, y, x - run, 1, last);
                        run = color === -1 ? -1 : x;
                        last = color;
                    }
                }
            }
        }, 1);
        const aboutLogoPixels = decodePng(path.join(__dirname, 'brmodz_logo.png'), 300, 124);
        const instagramPixels = decodePng(path.join(__dirname, 'qr_instagram.png'), 116, 120);
        const facebookPixels = decodePng(path.join(__dirname, 'qr_facebook.png'), 116, 120);
        const aboutLogo = rasterLayer('osa_about_logo', aboutLogoPixels);
        const instagramQr = rasterLayer('osa_about_instagram', instagramPixels);
        const facebookQr = rasterLayer('osa_about_facebook', facebookPixels);
        const HISTORY_FILE = path.join(ctx.dataDir, 'osa-warmup-history.json');
        const MAX_HISTORY = 300;
        let history = [];
        let atfHistory = [];
        let pendingCool = null;
        try {
            const saved = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
            if (Array.isArray(saved)) {
                history = saved.filter((x) => x && !x.kind && G.isNum(x.outside) && G.isNum(x.oilStart) && G.isNum(x.coolantStart) && G.isNum(x.oilMin) && G.isNum(x.coolantMin));
                atfHistory = saved.filter((x) => x && x.kind === 'atf-warm' && G.isNum(x.startTemp) && G.isNum(x.minutes));
                atfHistory = atfHistory.concat(saved.filter((x) => x && x.kind === 'atf-cool' && G.isNum(x.startTemp) && G.isNum(x.minutes)));
                const pending = saved.find((x) => x && x.kind === 'atf-cool-pending' && G.isNum(x.startTemp) && G.isNum(x.startedAt));
                if (pending) pendingCool = { startTemp: pending.startTemp, startedAt: pending.startedAt };
            }
        } catch (e) { /* first run or no history yet */ }
        const saveHistory = () => {
            const tmp = HISTORY_FILE + '.tmp';
            try {
                const rows = history.slice(-MAX_HISTORY).concat(atfHistory.slice(-MAX_HISTORY));
                if (pendingCool) rows.push({ kind: 'atf-cool-pending', startTemp: pendingCool.startTemp, startedAt: pendingCool.startedAt });
                fs.writeFileSync(tmp, JSON.stringify(rows));
                fs.renameSync(tmp, HISTORY_FILE);
            }
            catch (e) { log.warn('OSA history save: ' + e); try { fs.unlinkSync(tmp); } catch (ignore) {} }
        };
        let atfWasRunning = null;
        let atfWarmSession = null;
        let atfCoolSession = pendingCool;
        const updateAtfHistory = (d) => {
            const running = G.isNum(d.rpm) ? d.rpm >= 300 : null;
            const atf = transmission.fresh ? transmission.temp : null;
            const now = Date.now();
            if (running === null) return;
            if (running) {
                if (atfCoolSession) {
                    // A new engine run ends an interrupted cooling observation.
                    atfCoolSession = null;
                    pendingCool = null;
                    saveHistory();
                }
                if (!atfWarmSession && G.isNum(atf) && atf < 30) {
                    atfWarmSession = { start: mono(), startTemp: atf, outside: G.isNum(outsideTemp) ? outsideTemp : null };
                }
                if (atfWarmSession && G.isNum(atf) && atf >= 30) {
                    atfHistory.push({ kind: 'atf-warm', at: now, outside: atfWarmSession.outside,
                        startTemp: atfWarmSession.startTemp, minutes: (mono() - atfWarmSession.start) / 60000 });
                    atfHistory = atfHistory.slice(-MAX_HISTORY);
                    saveHistory();
                    log.info('OSA ATF warm-up history saved');
                    atfWarmSession = null;
                }
            } else {
                if (atfWasRunning === true) {
                    atfWarmSession = null;
                    if (G.isNum(atf) && atf > 40) {
                        atfCoolSession = { startTemp: atf, startedAt: now };
                        pendingCool = atfCoolSession;
                        saveHistory();
                    }
                }
                if (atfCoolSession && G.isNum(atf) && atf <= 30) {
                    atfHistory.push({ kind: 'atf-cool', at: now, startTemp: atfCoolSession.startTemp,
                        minutes: Math.max(0, (now - atfCoolSession.startedAt) / 60000) });
                    atfHistory = atfHistory.slice(-MAX_HISTORY);
                    atfCoolSession = null;
                    pendingCool = null;
                    saveHistory();
                    log.info('OSA ATF cool-down history saved');
                }
            }
            atfWasRunning = running;
        };
        const atfAverage = (kind) => {
            const rows = atfHistory.filter((x) => x.kind === kind);
            return rows.length ? rows.reduce((sum, x) => sum + x.minutes, 0) / rows.length : null;
        };
        let warmSession = null;
        let currentStart = null;
        let sessionDone = false;
        const similarHistory = (targetOil, targetCoolant) => {
            if (!currentStart) return null;
            for (let tol = 1; tol <= 5; tol++) {
                const matches = history.filter((x) => Math.abs(x.outside - currentStart.outside) <= tol && Math.abs(x.oilStart - currentStart.oilStart) <= tol && Math.abs(x.coolantStart - currentStart.coolantStart) <= tol && x.oilTarget === targetOil && x.coolantTarget === targetCoolant);
                if (matches.length) {
                    return {
                        oil: matches.reduce((sum, x) => sum + x.oilMin, 0) / matches.length,
                        coolant: matches.reduce((sum, x) => sum + x.coolantMin, 0) / matches.length,
                        count: matches.length, tolerance: tol
                    };
                }
            }
            return null;
        };
        const updateWarmHistory = (d, oilTarget, coolantTarget) => {
            const now = mono();
            if (d.demo || !G.isNum(d.rpm)) { warmSession = null; return; }
            if (d.rpm >= 300) {
                if (!warmSession && !sessionDone) {
                    if (!G.isNum(d.oil) || !G.isNum(d.coolant) || !G.isNum(outsideTemp)) return;
                    warmSession = { start: now, outside: outsideTemp, oilStart: d.oil, coolantStart: d.coolant,
                        oilTarget, coolantTarget, oilAt: null, coolantAt: null };
                    currentStart = { outside: outsideTemp, oilStart: d.oil, coolantStart: d.coolant };
                }
                if (warmSession.oilAt === null && G.isNum(d.oil) && d.oil >= warmSession.oilTarget) warmSession.oilAt = (now - warmSession.start) / 60000;
                if (warmSession.coolantAt === null && G.isNum(d.coolant) && d.coolant >= warmSession.coolantTarget) warmSession.coolantAt = (now - warmSession.start) / 60000;
                if (warmSession.oilAt !== null && warmSession.coolantAt !== null) {
                    history.push({ at: Date.now(), outside: warmSession.outside, oilStart: warmSession.oilStart,
                        coolantStart: warmSession.coolantStart, oilTarget: warmSession.oilTarget,
                        coolantTarget: warmSession.coolantTarget, oilMin: warmSession.oilAt, coolantMin: warmSession.coolantAt });
                    if (history.length > MAX_HISTORY) history = history.slice(-MAX_HISTORY);
                    saveHistory();
                    log.info('OSA warm-up history saved (' + history.length + ' records)');
                    warmSession = null;
                    sessionDone = true;
                }
            } else {
                // Engine stopped: discard an incomplete session and arm the next start.
                warmSession = null;
                sessionDone = false;
            }
        };
        const car = new Car(ctx, ['rpm', 'speed', 'temps']);
        const transmission = new TransmissionReader(ctx);
        let outsideTemp = null;
        ctx.signals.watch('de.bmw.infrastructure.EnvironmentalInformation', '1', {
            ExteriorTemperature: (v) => {
                const raw = v && v.temperatureExterior;
                outsideTemp = typeof raw === 'number' && isFinite(raw) && raw !== 255
                    ? raw * 0.5 - 40 : null;
            }
        }, log).then((sub) => {
            if (sub.error) log.warn('OSA outside temperature: ' + sub.error);
        });

        const hist = [];
        const mono = () => { const h = process.hrtime(); return h[0] * 1000 + h[1] / 1e6; };
        let lastHist = 0;
        // Keep the calculated heating rate stable between samples. The display
        // refreshes faster than the vehicle signals, so update this only on a
        // new temperature sample rather than on every rendered frame.
        const rateState = {
            oil: { sample: 0, rate: null },
            coolant: { sample: 0, rate: null }
        };
        car.onSample((d) => {
            const now = mono();
            if (now - lastHist > 5000 && (G.isNum(d.oil) || G.isNum(d.coolant))) {
                lastHist = now;
                hist.push([now, d.oil, d.coolant]);
                while (hist.length > 240) hist.shift();
            }
        }, () => {
            hist.length = 0;
            lastHist = 0;
            rateState.oil = { sample: 0, rate: null };
            rateState.coolant = { sample: 0, rate: null };
        });

        const TYPICAL = { oil: { drive: 4, idle: 1.5 }, coolant: { drive: 7, idle: 3 } };
        function measured(idx) {
            const last = hist.length ? hist[hist.length - 1][0] : 0;
            const pts = hist.filter((h) => G.isNum(h[idx]) && last - h[0] < 180000);
            if (pts.length < 4) return { rate: null, span: 0 };
            const n = pts.length;
            const mx = pts.reduce((a, p) => a + p[0], 0) / n;
            const my = pts.reduce((a, p) => a + p[idx], 0) / n;
            let num = 0, den = 0;
            pts.forEach((p) => { num += (p[0] - mx) * (p[idx] - my); den += (p[0] - mx) * (p[0] - mx); });
            return { rate: den ? num / den * 60000 : null, span: pts[n - 1][0] - pts[0][0] };
        }
        function eta(key, temp, target, d) {
            if (!G.isNum(temp)) return { state: 'none' };
            if (temp >= target) return { state: 'ready' };
            if (G.isNum(d.rpm) && d.rpm < 300) return { state: 'off' };
            const m = measured(key === 'oil' ? 1 : 2);
            const typ = TYPICAL[key][G.isNum(d.speed) && d.speed > 10 ? 'drive' : 'idle'];
            const w = G.clamp(m.span / 120000, 0, 1);
            const sample = hist.length ? hist[hist.length - 1][0] : 0;
            const state = rateState[key];
            if (sample && sample !== state.sample) {
                state.sample = sample;
                // Ignore implausible one-window spikes, then ease toward the
                // measured B57 warm-up rate instead of letting ETA jump.
                const ceiling = key === 'oil' ? 10 : 15;
                const observed = G.isNum(m.rate) ? G.clamp(m.rate, -1.5, ceiling) : typ;
                const candidate = w * observed + (1 - w) * typ;
                state.rate = G.isNum(state.rate) ? state.rate * 0.7 + candidate * 0.3 : candidate;
            }
            const rate = G.isNum(state.rate) ? state.rate : typ;
            if (w > 0.8 && rate < 0.15) return { state: 'stalled', rate };
            return { state: 'warming', min: (target - temp) / Math.max(0.15, rate), rate, est: w < 0.5 };
        }
        function etaRow(cv, t, y, label, e, target, historical) {
            cv.text(label, 952, y, 22, t.dim, { font: 'bold', spacing: 1.5 });
            let big, color = t.text, unit = '', right = '';
            if (e.state === 'ready') { big = 'READY'; color = t.ok; }
            else if (e.state === 'off') { big = 'ENGINE OFF'; color = t.dim; }
            else if (e.state === 'stalled') { big = 'NOT WARMING'; color = t.warn; right = 'drive to warm up'; }
            else if (e.state === 'warming') { big = e.min > 60 ? '>60' : '~' + Math.max(1, Math.round(e.min)); unit = 'min'; }
            else { big = '--'; color = t.dim; }
            const bw = cv.text(big, 952, y + 54, unit ? 52 : 38, color, { font: unit || big === '--' ? 'num' : 'bold', spacing: unit ? 0 : 1 });
            if (unit) cv.text('min', 960 + bw, y + 54, 25, t.dim);
            cv.text('target ' + Math.round(target) + '°C', 1552, y, 21, t.dim, { align: 'right' });
            if (right) cv.text(right, 1552, y + 48, 21, t.dim, { align: 'right' });
            if (historical !== null && historical !== undefined) {
                const histText = '(' + Math.max(1, Math.round(historical)) + ' min)';
                cv.text(histText, 1552, y + 54, 24, t.dim, { align: 'right', font: 'num' });
            }
            if (e.state === 'warming' && e.est) cv.text('estimate', 1552, y + 48, 18, t.dim, { align: 'right' });
        }

        function tbdTab(p) { return p >= 0 && p <= 3 ? p : -1; }

        function render() {
            const t = ctx.theme();
            const cv = ctx.canvas(W, H).clear(t.bg);

            const d = car.data();
            const oilTarget = Number(ctx.settings.get('warmOil')) || 80;
            const coolantTarget = Number(ctx.settings.get('warmCoolant')) || 80;
            updateWarmHistory(d, oilTarget, coolantTarget);
            updateAtfHistory(d);

            if (page === 0) {
                const oil = G.isNum(d.oil) ? d.oil : null;
                const status = oil === null ? 'NO OIL TEMP' : (d.demo ? 'DEMO DATA' : 'LIVE');
                const statusColor = oil === null ? t.dim : (d.demo ? t.warn : t.ok);

                // Engine page keeps BOTH Warm-Up temperature gauges:
                // engine oil and engine coolant. Transmission page is oil-only.
                G.segBar(cv, t, 24, 44, 880, 225, {
                    label: 'Oil',
                    value: oil,
                    unit: '°C',
                    decimals: 0,
                    min: 0,
                    max: 150,
                    step: 10,
                    scale: { every: 25 },
                    zones: [
                        { from: 120, to: 135, color: 'warn' },
                        { from: 135, to: 160, color: 'crit' }
                    ],
                    ramp: 'hot',
                    limit: 120
                });
                G.segBar(cv, t, 24, 286, 880, 225, {
                    label: 'Coolant',
                    value: G.isNum(d.coolant) ? d.coolant : null,
                    unit: '°C',
                    decimals: 0,
                    min: 0,
                    max: 150,
                    step: 10,
                    scale: { every: 25 },
                    zones: [
                        { from: 105, to: 120, color: 'warn' },
                        { from: 120, to: 150, color: 'crit' }
                    ],
                    ramp: 'hot',
                    limit: 105
                });

                const historical = similarHistory(oilTarget, coolantTarget);
                G.panel(cv, t, 928, 44, 648, 468, null);
                cv.roundRect(952, 70, 600, 60, 10, withAlpha(statusColor, 0.22));
                cv.text(status, 1252, 110, status.length > 14 ? 30 : 38, statusColor, {
                    align: 'center', font: 'bold', spacing: 3
                });
                cv.text('OUTSIDE TEMPERATURE', 952, 170, 22, t.dim, { font: 'bold', spacing: 1.5 });
                const outsideText = G.isNum(outsideTemp) ? ((outsideTemp > 0 ? '+' : '') + outsideTemp.toFixed(1)) : '--';
                cv.text(outsideText, 952, 225, 42, G.isNum(outsideTemp) ? t.text : t.dim, { font: 'num' });
                cv.text('°C', 1045, 225, 25, t.dim);
                etaRow(cv, t, 270, 'OIL READY IN', eta('oil', d.oil, oilTarget, d), oilTarget, historical ? historical.oil : null);
                etaRow(cv, t, 370, 'COOLANT READY IN', eta('coolant', d.coolant, coolantTarget, d), coolantTarget, historical ? historical.coolant : null);
                cv.text('BMW native vehicle signals · CDS / EnvironmentalInformation', 952, 475, 17, t.dim);
            } else if (page === 1) {
                const live = transmission.fresh;
                const value = live ? transmission.temp : null;
                const status = live ? 'LIVE' :
                    transmission.statusText === 'LIVE' ? 'LINK STALE' : transmission.statusText;
                const statusColor = live ? t.ok : t.dim;

                // Match the Engine oil page layout; only the data source and
                // transmission-specific temperature zones differ.
                G.segBar(cv, t, 24, 44, 880, 225, {
                    label: 'Oil',
                    value,
                    unit: '°C',
                    decimals: 0,
                    min: 0,
                    max: 150,
                    step: 10,
                    scale: { every: 25 },
                    zones: [
                        { from: 90, to: 110, color: 'warn' },
                        { from: 110, to: 150, color: 'crit' }
                    ],
                    ramp: 'hot',
                    limit: 110
                });

                G.panel(cv, t, 928, 44, 648, 468, null);
                cv.roundRect(952, 70, 600, 60, 10, withAlpha(statusColor, 0.22));
                cv.text(status, 1252, 110, status.length > 14 ? 30 : 38, statusColor, {
                    align: 'center', font: 'bold', spacing: 3
                });

                cv.text('TRANSMISSION OIL TEMPERATURE', 952, 170, 22, t.dim, {
                    font: 'bold', spacing: 1.5
                });
                cv.text(value === null ? '--' : String(Math.round(value)), 952, 245, 62, value === null ? t.dim : t.text, {
                    font: 'num'
                });
                cv.text('°C', value === null ? 1010 : 1018, 245, 27, t.dim);
                cv.text(transmission.sgbd ? ('EGS ' + transmission.sgbd + ' · DID 6000') : 'EGS · DID 6000', 952, 285, 18, t.dim);

                const engineRunning = G.isNum(d.rpm) && d.rpm >= 300;
                const atfMode = value !== null && value < 30 ? 'heat'
                    : (value !== null && value > 40 && !engineRunning ? 'cool' : null);
                if (atfMode === 'heat') {
                    cv.text('ATF HEAT-UP · TO 30°C', 952, 345, 20, t.dim, { font: 'bold', spacing: 1 });
                    const warmAvg = atfAverage('atf-warm');
                    const warmElapsed = atfWarmSession ? Math.max(1, Math.round((mono() - atfWarmSession.start) / 60000)) : null;
                    cv.text(atfWarmSession ? (warmElapsed + ' min elapsed') : (warmAvg === null ? 'COLLECTING DATA' : 'avg ' + Math.round(warmAvg) + ' min'), 952, 385, 26, atfWarmSession ? t.text : t.dim, { font: 'num' });
                } else if (atfMode === 'cool') {
                    cv.text('ATF COOL-DOWN · TO 30°C', 952, 345, 20, t.dim, { font: 'bold', spacing: 1 });
                    const coolAvg = atfAverage('atf-cool');
                    const coolElapsed = atfCoolSession ? Math.max(1, Math.round((Date.now() - atfCoolSession.startedAt) / 60000)) : null;
                    cv.text(atfCoolSession ? (coolElapsed + ' min elapsed') : (coolAvg === null ? 'COLLECTING DATA' : 'avg ' + Math.round(coolAvg) + ' min'), 952, 385, 26, atfCoolSession ? t.text : t.dim, { font: 'num' });
                } else {
                    cv.text('SERVICE TEMPERATURE MONITOR', 952, 345, 20, t.dim, { font: 'bold', spacing: 1 });
                    cv.text('HEAT <30°C  ·  COOL >40°C + ENGINE OFF', 952, 385, 20, t.dim);
                }
                cv.text('One service mode at a time · HEAT / COOL', 952, 445, 18, t.dim);
                if (transmission.error) cv.text(transmission.error, 952, 475, 17, t.warn, { maxWidth: 590 });
            } else if (page === 2) {
                G.panel(cv, t, 24, 44, 1552, 468, null);
                const statsHistory = history.filter((x) => x.oilTarget === oilTarget && x.coolantTarget === coolantTarget);
                cv.text('ENGINE WARM-UP HISTORY', 64, 95, 27, t.text, { font: 'bold', spacing: 2 });
                cv.text('RECORDS', 64, 145, 18, t.dim, { font: 'bold' });
                cv.text(String(statsHistory.length), 64, 205, 42, t.text, { font: 'num' });
                const avgOil = statsHistory.length ? statsHistory.reduce((s, x) => s + x.oilMin, 0) / statsHistory.length : null;
                const avgCoolant = statsHistory.length ? statsHistory.reduce((s, x) => s + x.coolantMin, 0) / statsHistory.length : null;
                cv.text('OIL AVERAGE', 300, 145, 18, t.dim, { font: 'bold' });
                cv.text(avgOil === null ? '--' : Math.round(avgOil) + ' min', 300, 205, 32, avgOil === null ? t.dim : t.text, { font: 'num' });
                cv.text('COOLANT AVERAGE', 570, 145, 18, t.dim, { font: 'bold' });
                cv.text(avgCoolant === null ? '--' : Math.round(avgCoolant) + ' min', 570, 205, 32, avgCoolant === null ? t.dim : t.text, { font: 'num' });
                cv.text('TRANSMISSION ATF HISTORY', 64, 285, 27, t.text, { font: 'bold', spacing: 2 });
                const warmRows = atfHistory.filter((x) => x.kind === 'atf-warm');
                const coolRows = atfHistory.filter((x) => x.kind === 'atf-cool');
                cv.text('WARM-UP RECORDS', 64, 345, 18, t.dim, { font: 'bold' });
                cv.text(String(warmRows.length), 64, 400, 30, t.text, { font: 'num' });
                cv.text('AVERAGE TO 30°C', 300, 345, 18, t.dim, { font: 'bold' });
                cv.text(atfAverage('atf-warm') === null ? '--' : Math.round(atfAverage('atf-warm')) + ' min', 300, 400, 30, t.text, { font: 'num' });
                cv.text('COOL-DOWN RECORDS', 700, 345, 18, t.dim, { font: 'bold' });
                cv.text(String(coolRows.length), 700, 400, 30, t.text, { font: 'num' });
                cv.text('AVERAGE TO 30°C', 960, 345, 18, t.dim, { font: 'bold' });
                cv.text(atfAverage('atf-cool') === null ? '--' : Math.round(atfAverage('atf-cool')) + ' min', 960, 400, 30, t.text, { font: 'num' });
                cv.text('ATF warm-up starts below 30°C; cool-down starts above 40°C after engine stop.', 64, 470, 18, t.dim);
            } else if (page === 3) {
                G.panel(cv, t, 24, 44, 1552, 468, null);
                cv.blit(aboutLogo, 650, 58);
                cv.text('OIL SERVICE ASSISTANT', 800, 225, 30, t.text,
                    { align: 'center', font: 'bold', spacing: 2.5 });
                cv.text('Monitors engine oil, coolant and transmission oil temperatures during service.', 800, 258, 19, t.dim, { align: 'center' });
                cv.text('Live estimates show the expected time to reach the selected target temperature.', 800, 285, 19, t.dim, { align: 'center' });
                cv.text('Starting conditions and completed warm-up times are stored locally on the head unit.', 800, 312, 19, t.dim, { align: 'center' });
                cv.text('Previous sessions provide historical comparisons; data is never uploaded to the cloud.', 800, 339, 19, t.dim, { align: 'center' });
                cv.text('Developed by dzooky@bmrmodz', 800, 372, 18, t.text, { align: 'center', font: 'bold' });
                cv.blit(instagramQr, 660, 390);
                cv.blit(facebookQr, 824, 390);
            }

            G.frame(cv, t, ['Engine', 'Transmission', 'Statistics', 'About'], tbdTab(page), []);
            return ui.image('MAIN_GFX', cv);
        }

        const switchPage = (next) => {
            page = (next + 4) % 4;
            return render();
        };

        ui.onClick('BTN_PAGE', () => switchPage(page + 1));
        ui.onClick('BTN_PREV', () => switchPage(page + 2));
        ctx.onTab((i) => {
            // Display maps the visual header index back to the app tab index;
            // App tabs map directly; Test is tab 3 and About is tab 4.
            if (i !== page && i >= 0 && i <= 4) return switchPage(i);
        });

        ui.onVisible((name, on) => {
            if (name === 'MAIN') transmission.setVisible(on);
        });
        transmission.setVisible(ui.isVisible('MAIN'));
        transmission.init().catch((e) => log.warn('OSA diagnostic link: ' + e));

        ctx.loop('MAIN', 4, render);
        render()
            .then(() => log.info('OSA first frame rendered'))
            .catch((e) => log.warn('OSA first render: ' + e));
    },
});
