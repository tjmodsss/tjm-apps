'use strict';

/**
 * DPF Status
 *
 * Read-only DDE monitor. Identifies DDE 0x12 via physical UDS 22 F1 50.
 * Displays DPF measurements for the identified B57 DDE.
 *
 * No diagnostic service other than the read-only services exposed by
 * ReadOnlyDiag can be sent by this app.
 */
const mgu = require('./kit/mgu');
const G = require('./kit/gauges');
const path = require('path');
const { decode: decodePng } = require('./png');
const { ReadOnlyDiag } = require('./kit/readonly-diag');

const W = 1600;
const H = 520;
const TABS = ['Overview', 'Detail', 'About'];

mgu.run({
    async start(ctx) {
        const { ui, log } = ctx;
        const link = new ReadOnlyDiag(ctx.signals, log, {
            gapMs: 50, busyMs: 500,
            onDebug: message => {
                if (/^(SENDING|TRANSPORT|FRAME|NO MATCHING RESPONSE|REPLY|SKIPPED)/.test(message)) {
                    log.info('DPF TASU ' + message.slice(0, 100));
                }
            }
        });
        const DDE = 0x12;
        const EXPECTED = '0F1FE8';
        let identified = false;
        let identifying = true;
        let readAttempted = false;
        let testing = false;
        const readings = {};
        let page = 'overview';
        let readPending = false;
        let detailReadAttempted = false;
        const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
        const requestOptions = { maxRetries: 2, retryBaseMs: 500, callTimeoutMs: 2500, hardTimeoutMs: 6500, pendingTimeoutMs: 2500 };
        const dids = [
            ['SOOT', 0x44BE, 2, 0.01525902],
            ['ASH', 0x44BD, 2, 0.01525902],
            ['SINCE', 0x44BF, 4, 1],
            ['AVERAGE', 0x4B2F, 4, 1],
            ['REQUEST', 0x44BB, 1, 1],
            ['MODE', 0x467E, 4, 1]
        ];
        // D83BX7C0A ReadDataByIdentifier scalings and offsets.
        const detailDids = [
            ['PRESSURE', 0x44EB, 2, 0.03814755, 500],
            ['TEMP', 0x44EF, 2, 0.03128099, -50],
            ['RUNTIME', 0x44B7, 4, 1],
            ['LOCK', 0x44C2, 1, 1],
            ['AVG TEMP', 0x4B4A, 2, 0.1, -3276.7],
            ['REMAINING', 0x4C78, 2, 10]
        ];
        const hexBytes = a => a.map(b=>b.toString(16).toUpperCase().padStart(2,'0')).join(' ');
        async function testSelected() {
            if (!identified || page === 'about') return;
            if (testing) {
                readPending = true;
                return;
            }
            testing = true;
            const address = DDE;
            const readingPage = page;
            const selected = readingPage === 'detail' ? detailDids : dids;
            try {
                link.wake(address);
                for (const [name, did, len, factor, offset = 0] of selected) {
                    const response = await link.physical(address, 0x22, [(did >> 8) & 255, did & 255], 1800,
                        u => u && ((u[0] === 0x62 && u[1] === (did >> 8) && u[2] === (did & 255)) || (u[0] === 0x7F && u[1] === 0x22)),
                        requestOptions);
                    let result = 'TIMEOUT';
                    if(response) {
                        if(response[0] === 0x7F) result = 'NRC '+hexBytes(response);
                        else if(response[0] === 0x62 && response[1] === (did>>8) && response[2] === (did&255)) {
                            const bytes = response.slice(3);
                            if(bytes.length === len) {
                                let raw = 0;
                                for(const b of bytes) raw = raw*256+b;
                                result = hexBytes(bytes)+' = '+(raw * factor + offset).toFixed(Number.isInteger(factor) ? 0 : 2);
                            } else result = 'LEN '+bytes.length+' '+hexBytes(bytes);
                        } else result = 'UNEXPECTED '+hexBytes(response);
                    }
                    if (response && response[0] === 0x62 && response[1] === (did >> 8) && response[2] === (did & 255) && response.length === len + 3) {
                        let raw = 0;
                        for (const b of response.slice(3)) raw = raw * 256 + b;
                        readings[name] = { raw, value: raw * factor + offset, at: Date.now() };
                    } else if (name === 'REQUEST' || name === 'MODE' || name === 'LOCK') {
                        delete readings[name];
                    }
                    const line = name+' '+did.toString(16).toUpperCase()+': '+result;
                    log.info('DPF READ ECU '+address.toString(16)+' '+line);
                    if (readPending && page !== readingPage) break;
                }
            } catch (e) { log.warn('DPF read: ' + String(e)); }
            finally {
                testing = false;
                if (readingPage === 'detail') detailReadAttempted = true;
                else readAttempted = true;
                if (readPending) {
                    readPending = false;
                    if (page !== readingPage && ui.isVisible('MAIN')) await testSelected();
                }
            }
        }


        const identify = async () => {
            identified = false;
            try {
                if (!link.ready) await link.init();
                if (!link.available) {
                    log.warn('DPF diagnostic link unavailable: ' + (link.error || 'TASU unavailable'));
                    return;
                }
                link.wake(DDE);
                const u = await link.physical(DDE, 0x22, [0xF1, 0x50], 1800,
                    b => b && ((b[0] === 0x62 && b[1] === 0xF1 && b[2] === 0x50) || (b[0] === 0x7F && b[1] === 0x22)),
                    requestOptions);
                if (!u) { log.warn('DPF DDE did not respond'); return; }
                if (u[0] !== 0x62 || u.length < 6) {
                    log.warn('DPF DDE identification refused: ' + hexBytes(u));
                    return;
                }
                const actual = hexBytes(u.slice(3, 6)).replace(/ /g, '');
                if (actual !== EXPECTED) {
                    log.warn('DPF unexpected DDE: ' + actual + ' (expected ' + EXPECTED + ')');
                    return;
                }
                identified = true;
            } catch (e) {
                log.warn('DPF identify: ' + String(e.message || e));
            }
        };

        const hasReading = key => !!readings[key];
        const hasMeasurements = () => ['SOOT', 'ASH', 'SINCE', 'AVERAGE'].some(hasReading);
        const hasDetailMeasurements = () => detailDids.some(([key]) => hasReading(key) && !stale(key));
        const stale = key => hasReading(key) && Date.now() - readings[key].at >= 90000;

        const rasterRuns = src => {
            const d = src.d, w = src.w, h = src.h;
            // Join matching runs across rows to avoid seams inside solid areas.
            let previousRuns = new Map();
            const runs = [];
            const keepRun = run => runs.push(run);
            for (let y = 0; y < h; y++) {
                const currentRuns = new Map();
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
                        if (last !== -1) {
                            const id = run + ':' + x + ':' + last;
                            const rect = previousRuns.get(id);
                            if (rect) {
                                rect.height++;
                                previousRuns.delete(id);
                                currentRuns.set(id, rect);
                            } else {
                                currentRuns.set(id, { x: run, y, width: x - run, height: 1, color: last });
                            }
                        }
                        run = color === -1 ? -1 : x;
                        last = color;
                    }
                }
                previousRuns.forEach(keepRun);
                previousRuns = currentRuns;
            }
            previousRuns.forEach(keepRun);
            return runs;
        };
        let aboutLogoRuns;
        let aboutLayers;
        function renderAbout(cv, t) {
            if (!aboutLayers) {
                aboutLogoRuns = rasterRuns(decodePng(path.join(__dirname, 'brmodz_logo.png'), 300, 124));
                aboutLayers = [
                    ['dpf_about_instagram', 'qr_instagram.png', 116, 120, 660, 390],
                    ['dpf_about_facebook', 'qr_facebook.png', 116, 120, 824, 390]
                ].map(([key, file, width, height, x, y]) => {
                    const runs = rasterRuns(decodePng(path.join(__dirname, file), width, height));
                    const layer = G.layer(key, width, height, canvas => {
                        runs.forEach(run => canvas.fillRect(run.x, run.y, run.width, run.height, run.color));
                    }, 1);
                    return [layer, x, y];
                });
            }
            G.panel(cv, t, 24, 44, 1552, 468, null);
            // Full-screen iDrive scales the canvas. Align adjacent runs to the
            // same display-pixel boundaries so fractional edges cannot leave seams.
            const scale = cv.place ? cv.place.scale : 1;
            const pixelEdge = coordinate => Math.round(coordinate * scale) / scale;
            aboutLogoRuns.forEach(run => {
                const x = 650 + run.x;
                const y = 58 + run.y;
                const left = pixelEdge(x);
                const top = pixelEdge(y);
                const right = pixelEdge(x + run.width);
                const bottom = pixelEdge(y + run.height);
                cv.fillRect(left, top, right - left, bottom - top, run.color);
            });
            aboutLayers.forEach(([layer, x, y]) => cv.blit(layer, x, y));
            cv.text('DPF STATUS', 800, 225, 30, t.text,
                { align: 'center', font: 'bold', spacing: 2.5 });
            cv.text('Read-only diesel particulate filter monitor for BMW iDrive 7.', 800, 258, 19, t.dim, { align: 'center' });
            cv.text('Shows soot and ash mass, regeneration distances and status, plus detailed DPF measurements.', 800, 285, 19, t.dim, { align: 'center' });
            cv.text('Reads data from supported B57 DDE units.', 800, 312, 19, t.dim, { align: 'center' });
            cv.text('Developed by dzooky@bmrmodz', 800, 372, 18, t.text,
                { align: 'center', font: 'bold' });
        }

        function renderDetail(cv, t) {
            cv.text('DPF DETAIL', 48, 75, 32, t.text, { font: 'bold' });
            if (!hasDetailMeasurements()) {
                const loading = identifying || (identified && !detailReadAttempted);
                cv.text(loading ? 'LOADING DETAIL DATA' : 'NO DETAIL DATA',
                    1552, 75, 18, loading ? t.dim : t.warn, { align: 'right', font: 'bold' });
            }
            const measurement = (key, digits, unit) => hasReading(key)
                ? readings[key].value.toFixed(digits) + ' ' + unit : '--';
            const runtime = hasReading('RUNTIME') ? readings.RUNTIME.raw : undefined;
            const duration = runtime === undefined ? '--' : [
                Math.floor(runtime / 3600),
                Math.floor(runtime / 60) % 60,
                runtime % 60
            ].map(part => String(part).padStart(2, '0')).join(':');
            const release = hasReading('LOCK') && !stale('LOCK')
                ? (readings.LOCK.raw === 0 ? 'ALLOWED' : 'BLOCKED') : 'UNKNOWN';
            const rows = [
                ['PRESSURE BEFORE DPF', measurement('PRESSURE', 1, 'hPa'), 'PRESSURE'],
                ['TEMPERATURE BEFORE DPF', measurement('TEMP', 1, '°C'), 'TEMP'],
                ['ENGINE TIME SINCE REGEN', duration, 'RUNTIME'],
                ['REGENERATION PERMISSION', release],
                ['AVG TEMP DURING REGEN', measurement('AVG TEMP', 1, '°C'), 'AVG TEMP'],
                ['EST. FILTER DISTANCE LEFT', measurement('REMAINING', 0, 'km'), 'REMAINING']
            ];
            rows.forEach(([label, value, key], i) => {
                const x = 48 + (i % 2) * 768;
                const y = 96 + Math.floor(i / 2) * 128;
                cv.roundRect(x, y, 736, 108, 8, t.panel || t.bg);
                cv.text(label, x + 16, y + 32, 18, t.dim, { font: 'bold' });
                cv.text(value, x + 716, y + 80, 35, t.text, { align: 'right' });
                if (stale(key)) cv.text('STALE', x + 16, y + 80, 14, t.warn);
            });
        }

        function render() {
            const t = ctx.theme();
            const cv = ctx.canvas(W, H).clear(t.bg);

            if (page === 'detail') {
                renderDetail(cv, t);
                G.frame(cv, t, TABS, 1, []);
                return ui.image('MAIN_GFX', cv);
            }
            if (page === 'about') {
                renderAbout(cv, t);
                G.frame(cv, t, TABS, 2, []);
                return ui.image('MAIN_GFX', cv);
            }

            const gutter = 16;
            const columnWidth = (W - 48 - 2 * gutter) * 0.4;
            const massX = 24;
            const distanceX = massX + columnWidth + gutter;
            const statusX = distanceX + columnWidth + gutter;
            const statusWidth = W - 24 - statusX;

            const loading = !readAttempted && (identifying || identified);

            function gauge(key, label, unit, max, step, tick, decimals, x, y, scaleDecimals = 0) {
                const reading = readings[key];
                const value = reading ? (unit === 'km' ? reading.raw / 1000 : reading.value) : null;
                G.segBar(cv, t, x, y, columnWidth, 222, {
                    label, value, unit, decimals,
                    min: 0, max, step,
                    ramp: 'hot', limit: max,
                    zones: [
                        { from: max * (90 / 150), to: max * (110 / 150), color: 'warn' },
                        { from: max * (110 / 150), to: max, color: 'crit' }
                    ],
                    scale: { every: tick, decimals: scaleDecimals }
                });
                if (stale(key)) cv.text('STALE', x + 18, y + 66, 15, t.warn, { font: 'bold' });
            }

            gauge('SOOT', 'Soot mass', 'g', 100, 5, 20, 2, massX, 44);
            gauge('ASH', 'Ash mass', 'g', 100, 5, 20, 2, massX, 286);

            const averageKm = readings.AVERAGE ? readings.AVERAGE.raw / 1000 : 0;
            if (averageKm > 0) {
                gauge('SINCE', 'Since last regen', 'km', averageKm, averageKm / 16,
                    averageKm / 2, 1, distanceX, 44, 1);
                if (stale('AVERAGE') && !stale('SINCE')) {
                    cv.text('AVG STALE', distanceX + 18, 110, 15, t.warn, { font: 'bold' });
                }
            } else {
                gauge('SINCE', 'Since last regen', 'km', 800, 50, 200, 1, distanceX, 44);
                if (!loading && !stale('SINCE')) cv.text('AVG UNAVAILABLE', distanceX + 18, 110, 15, t.dim, { font: 'bold' });
            }
            gauge('AVERAGE', 'Avg regen interval', 'km', 800, 50, 200, 1, distanceX, 286);

            G.panel(cv, t, statusX, 44, statusWidth, 464, null);
            cv.text('REGENERATION', statusX + 18, 83, 20, t.text, { font: 'bold' });
            // D83BX7C0A STATUS_REGENERATION_CSF decoding, using direct ReadDataByIdentifier.
            const modeKnown = hasReading('MODE') && !stale('MODE');
            const requestKnown = hasReading('REQUEST') && !stale('REQUEST');
            const inProgress = modeKnown && (readings.MODE.raw & 0x02) !== 0;
            let statusText = 'UNKNOWN';
            let statusColor = t.warn;
            if (inProgress) {
                statusText = 'IN PROGRESS';
                statusColor = t.ok;
            } else if (modeKnown && requestKnown) {
                const request = readings.REQUEST.raw;
                const requested = request >= 4 && request <= 6;
                statusText = requested ? 'REQUESTED' : 'NOT NEEDED';
                statusColor = requested ? t.warn : t.dim;
            }
            cv.text(statusText, statusX + 18, 150, 30, statusColor, { font: 'bold' });

            const estimateAvailable = !inProgress && averageKm > 0 && !stale('AVERAGE')
                && hasReading('SINCE') && !stale('SINCE');
            const sinceKm = estimateAvailable ? readings.SINCE.raw / 1000 : null;
            const remainingKm = estimateAvailable ? Math.max(0, averageKm - sinceKm) : null;
            cv.text('EST. DISTANCE TO REGEN', statusX + 18, 252, 16, t.dim, { font: 'bold' });
            cv.text(remainingKm === null ? '--' : remainingKm.toFixed(1) + ' km',
                statusX + 18, 315, 42, t.text, { font: 'num' });
            if (estimateAvailable) {
                G.segBar(cv, t, statusX + 18, 342, statusWidth - 36, 26, {
                    panel: false, ramp: 'hot', min: 0, max: averageKm, step: averageKm / 12, value: sinceKm
                });
            }

            if (!hasMeasurements()) {
                cv.text(loading ? 'LOADING DPF DATA' : 'NO DPF DATA',
                    statusX + 18, 438, 18, loading ? t.dim : t.warn, { font: 'bold' });
            }

            G.frame(cv, t, TABS, 0, []);
            return ui.image('MAIN_GFX', cv);
        }

        function openPage(next) {
            const openingDetail = next === 'detail' && page !== 'detail';
            page = next;
            if (openingDetail || next === 'overview') testSelected();
            return render();
        }

        ctx.onTab(index => {
            const next = ['overview', 'detail', 'about'][index];
            if (next && next !== page) return openPage(next);
        });
        ui.onVisible((name, visible) => {
            if (name === 'MAIN' && visible && identified && !testing
                && (page === 'detail' ? !hasDetailMeasurements() : !readAttempted)) {
                testSelected();
            }
        });
        ctx.loop('MAIN', 4, render);
        // Let the app initialize while the diagnostic link is connecting.
        (async () => {
            await identify();
            identifying = false;
            if (identified && page !== 'about' && ui.isVisible('MAIN')) await testSelected();
            // Retry startup failures promptly while the data screen is open.
            while (true) {
                const dataReady = page === 'detail' ? hasDetailMeasurements() : hasMeasurements();
                await sleep(dataReady ? 60000 : 5000);
                if (testing || page === 'about' || !ui.isVisible('MAIN')) continue;
                if (!identified) await identify();
                if (identified && page !== 'about' && ui.isVisible('MAIN')) await testSelected();
            }
        })().catch(e => log.warn('DPF polling: ' + e));
        render()
            .then(() => log.info('DPF Status first frame rendered'))
            .catch((e) => log.warn('DPF Status first render: ' + e));
    }
});
