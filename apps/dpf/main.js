'use strict';

/**
 * DPF Status
 *
 * Read-only DDE monitor. Identifies DDE 0x12 via physical UDS 22 F1 50.
 * Displays validated DPF measurements for identified B57 or B47 DDE.
 *
 * No diagnostic service other than the read-only services exposed by
 * ReadOnlyDiag can be sent by this app.
 */
const mgu = require('./kit/mgu');
const G = require('./kit/gauges');
const fs = require('fs');
const path = require('path');
const { decode: decodePng } = require('./png');
const regenMessage = require('./regen-message');
const ddeProfiles = require('./dde-profiles');
const { t: translate, setRuntimeTranslations } = require('./kit/i18n');
const locales = require('./translations');
const { ReadOnlyDiag } = require('./kit/readonly-diag');
const CarEquipment = require('./kit/car-equipment');

const W = 1600;
const H = 520;
const TABS = ['Overview', 'Detail', 'About'];

mgu.run({
    async start(ctx) {
        const { ui, log } = ctx;
        // Never enable cluster messages without confirmed 6WB in the cached VO.
        // An unresolved VO is a temporary state, not a reason to overwrite user preferences.
        ctx.settings.values.cluster6wbAvailable = false;
        let equipmentChecking = false;
        let equipmentCheckedAt = 0;
        let equipmentRetry = null;
        function scheduleEquipmentCheck() {
            if (equipmentRetry) return;
            equipmentRetry = setTimeout(() => {
                equipmentRetry = null;
                refreshClusterEquipment().catch(error => log.warn('DPF Car Equipment retry: ' + error));
            }, 10000);
        }
        async function refreshClusterEquipment(force = false) {
            if (equipmentChecking || (!force && Date.now() - equipmentCheckedAt < 10000)) return;
            equipmentChecking = true;
            equipmentCheckedAt = Date.now();
            try {
                if (force) {
                    const reloaded = await CarEquipment.request({ op: 'reload' }, { timeout: 15000 });
                    if (!reloaded || reloaded.ok !== true || reloaded.available !== true)
                        log.warn('DPF Car Equipment reload: ' + (reloaded && reloaded.error || 'VO not yet available'));
                }
                const result = await CarEquipment.has('6WB', { timeout: 12000 });
                const supported = result === true;
                ctx.settings.set('cluster6wbAvailable', supported);
                log.info('DPF Car Equipment 6WB (VO) = ' + result);
                if (result !== true && result !== false) scheduleEquipmentCheck();
                else if (equipmentRetry) { clearTimeout(equipmentRetry); equipmentRetry = null; }
            } catch (error) {
                ctx.settings.set('cluster6wbAvailable', false);
                log.warn('DPF Car Equipment 6WB: ' + String(error && error.message || error));
                scheduleEquipmentCheck();
            } finally { equipmentChecking = false; }
        }
        ctx.settings.onAction('reloadEquipment', () => {
            refreshClusterEquipment(true).catch(error => log.warn('DPF manual equipment reload: ' + error));
        });
        refreshClusterEquipment().catch(error => log.warn('DPF Car Equipment: ' + error));

        let idriveLanguage = 'en';
        const languageOptions = ctx.settings.item('language').options.map(([code, label]) =>
            [code === 'auto' ? 'en' : code, label.replace(/ \(auto\)$/, '')]);
        function updateAutomaticLanguage() {
            const setting = ctx.settings.item('language');
            const options = languageOptions.map(([code, label]) =>
                code === idriveLanguage ? ['auto', label + ' (auto)'] : [code, label]);
            setting.options.splice(0, setting.options.length, ...options);
            options.forEach(([, label], index) => ui.text('SET_LANGUAGE', label, index, 'ItemText'));
            const selected = ctx.settings.get('language');
            ui.selected('SET_LANGUAGE', Math.max(0, options.findIndex(([code]) => code === selected)));
        }
        function applyLanguage() {
            if (ctx.settings.get('language') === idriveLanguage) {
                ctx.settings.set('language', 'auto');
            }
            const selected = ctx.settings.get('language');
            const language = selected === 'auto' ? idriveLanguage : selected;
            setRuntimeTranslations(locales[language] || null);
            updateAutomaticLanguage();
            ui.text('BTN_SETTINGS', translate('Settings'));
            const component = ui.comp('SET_LANGUAGE');
            if (component && typeof component.getStringBundle === 'function') {
                component.getStringBundle().setStrings({ SID_DPF_SET_LANGUAGE: translate('Language') })
                    .catch(error => log.warn('DPF language label: ' + error.message));
            }

        }
        applyLanguage();
        ctx.settings.onChange(key => { if (key === 'language') applyLanguage(); });
        require('./idrive-language').watch(ctx, language => {
            idriveLanguage = language;
            applyLanguage();
        });

        const link = new ReadOnlyDiag(ctx.signals, log, {
            gapMs: 50, busyMs: 500,
            onDebug: message => {
                if (/^(SENDING|TRANSPORT|FRAME|NO MATCHING RESPONSE|REPLY|SKIPPED)/.test(message)) {
                    log.info('DPF TASU ' + message.slice(0, 100));
                }
            }
        });
        const DDE = 0x12;
        let profile = null;
        let ddeIndex = null;
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
        // B57 calibration is unchanged; B47 gets only its verified DIDs.
        const overviewDids = () => profile ? profile.overview : [];
        const detailDids = () => profile ? profile.detail : [];
        const regenDids = () => profile && profile.regeneration
            ? profile.overview.filter(([key]) => key === 'REQUEST' || key === 'MODE') : [];
        const hexBytes = a => a.map(b=>b.toString(16).toUpperCase().padStart(2,'0')).join(' ');
        async function testSelected(regenOnly = false) {
            if (!identified || (!regenOnly && page === 'about')) return;
            if (testing) {
                readPending = true;
                return;
            }
            testing = true;
            const address = DDE;
            const readingPage = page;
            const selected = regenOnly ? regenDids() : readingPage === 'detail' ? detailDids() : overviewDids();
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
                if (!regenOnly) {
                    if (readingPage === 'detail') detailReadAttempted = true;
                    else readAttempted = true;
                }
                if (readPending) {
                    readPending = false;
                    if ((regenOnly || page !== readingPage) && ui.isVisible('MAIN')) await testSelected();
                }
            }
        }


        const identify = async () => {
            identified = false;
            profile = null;
            ddeIndex = null;
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
                ddeIndex = actual;
                profile = ddeProfiles.forDde(actual);
                if (!profile) {
                    log.warn('DPF unsupported DDE index: ' + actual);
                    return;
                }
                log.info('DPF DDE ' + profile.engine + ' detected (index ' + actual + ')');
                identified = true;
            } catch (e) {
                log.warn('DPF identify: ' + String(e.message || e));
            }
        };

        const hasReading = key => !!readings[key];
        const hasMeasurements = () => ['SOOT', 'ASH', 'SINCE', 'AVERAGE'].some(hasReading);
        const hasDetailMeasurements = () => detailDids().some(([key]) => hasReading(key) && !stale(key));
        const stale = key => hasReading(key) && Date.now() - readings[key].at >= 90000;

        function regenState(maxAge = 90000) {
            // Never reuse B57 mode bit semantics on unverified B47 values.
            if (!profile || !profile.regeneration) return null;
            const now = Date.now();
            const mode = readings.MODE;
            if (!mode || now - mode.at >= maxAge) return null;
            if (mode.raw & 0x02) return 'active';
            const request = readings.REQUEST;
            if (!request || now - request.at >= maxAge) return null;
            return request.raw >= 4 && request.raw <= 6 ? 'requested' : 'idle';
        }

        const clusterEnabled = () => !!(profile && profile.regeneration) &&
            ctx.settings.values.cluster6wbAvailable === true && ctx.settings.get('regenCluster') === true;
        const indicator = regenMessage.createIndicator();
        let clusterTestStartedAt = null;
        ctx.settings.onAction('regenClusterTest', () => {
            if (profile && profile.regeneration && ctx.settings.values.cluster6wbAvailable === true)
                clusterTestStartedAt = Date.now();
        });
        regenMessage.start(log, () => {
            const now = Date.now();
            const liveMessage = indicator(clusterEnabled() ? regenState(15000) : null, now);
            if (clusterTestStartedAt !== null) {
                const message = regenMessage.testMessage(now - clusterTestStartedAt);
                if (message) return message;
                clusterTestStartedAt = null;
            }
            return liveMessage;
        });

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
                const feedback = [
                    ['dpf_about_bug', 'qr_report_bug.png', 102, 102, 667, 384, 'Report a bug'],
                    ['dpf_about_feature', 'qr_request_feature.png', 102, 102, 831, 384, 'Request a feature']
                ];
                const hasFeedback = feedback.every(([, file]) => fs.existsSync(path.join(__dirname, file)));
                const y = hasFeedback ? 375 : 390;
                const links = [
                    ['dpf_about_instagram', 'qr_instagram.png', 116, 120, hasFeedback ? 332 : 500, y, hasFeedback ? 'Instagram' : null],
                    ['dpf_about_facebook', 'qr_facebook.png', 116, 120, hasFeedback ? 496 : 664, y, hasFeedback ? 'Facebook' : null]
                ];
                aboutLayers = links.concat(hasFeedback ? feedback : []).map(([key, file, width, height, x, y, label]) => {
                    const runs = rasterRuns(decodePng(path.join(__dirname, file), width, height));
                    const feedback = key === 'dpf_about_bug' || key === 'dpf_about_feature';
                    return { runs: feedback ? runs.filter(run => run.color !== 0xffffffff) : runs,
                        x, y, width, height, label, feedback };
                });
            }
            G.panel(cv, t, 24, 44, 1552, 468, null);
            // Full-screen iDrive scales the canvas. Align adjacent runs to the
            // same display-pixel boundaries so fractional edges cannot leave seams.
            const scale = cv.place ? cv.place.scale : 1;
            const pixelEdge = coordinate => Math.round(coordinate * scale) / scale;
            const drawRect = (x, y, width, height, color) => {
                const left = pixelEdge(x);
                const top = pixelEdge(y);
                const right = pixelEdge(x + width);
                const bottom = pixelEdge(y + height);
                cv.fillRect(left, top, right - left, bottom - top, color);
            };
            const drawRuns = (runs, x, y) => {
                runs.forEach(run => drawRect(x + run.x, y + run.y, run.width, run.height, run.color));
            };
            drawRuns(aboutLogoRuns, 490, 58);
            aboutLayers.forEach(({ runs, x, y, width, height, label, feedback }) => {
                if (feedback) drawRect(x, y, width, height, 0xffffffff);
                drawRuns(runs, x, y);
                if (label) cv.text(label, x + width / 2, 512, 15, t.text, { align: 'center' });
            });
            cv.text('DPF STATUS', 640, 225, 30, t.text,
                { align: 'center', font: 'bold', spacing: 2.5 });
            cv.text('Read-only diesel particulate filter monitor for BMW iDrive 7.', 640, 258, 19, t.dim, { align: 'center' });
            cv.text('Supports B57 and B47 DDE with validated soot, ash and distances.', 640, 285, 19, t.dim, { align: 'center' });
            cv.text('Regeneration status and advanced detail are verified on B57 only.', 640, 312, 19, t.dim, { align: 'center' });

            const newsX = 1120;
            const milestones = [
                ['0.1.38', 'B47 core gauges with automatic DDE detection'],
                ['0.1.37', 'Started alert translated into all languages'],
                ['0.1.36', 'New Started alert on regeneration begin'],
                ['0.1.34', 'Cluster notification settings require detected 6WB'],
                ['0.1.31', 'All 22 iDrive languages'],
                ['0.1.26', 'Cluster regeneration messages'],
                ['0.1.24', 'Equal-height gauges on Overview'],
                ['0.1.23', 'Milestones and clearer regen estimate'],
                ['0.1.21', 'Feedback QR codes in About'],
                ['0.1.17', 'Faster loading of Detail measurements'],
                ['0.1.16', 'Colour gauges'],
                ['0.1.9', 'Three tabs, regen status and distance estimate'],
                ['0.1.6', 'Live readings and periodic refresh'],
                ['0.1.0', 'First read-only DPF diagnostics']
            ];
            cv.text("WHAT'S NEW", newsX, 80, 22, t.text, { font: 'bold' });
            milestones.forEach(([version, label], index) => {
                const y = 104 + index * 20;
                cv.text(version, newsX, y, 14, t.text, { font: 'bold' });
                cv.text(label, newsX + 66, y, 14, t.dim);
            });

            cv.text('Developed by dzooky@bmrmodz', 640, aboutLayers.length > 2 ? 363 : 372, 18, t.text,
                { align: 'center', font: 'bold' });
        }

        function renderDetail(cv, t) {
            cv.text('DPF DETAIL', 48, 75, 32, t.text, { font: 'bold' });
            if (profile && !profile.detail.length) {
                cv.text('Additional B47 measurements are not verified yet', 800, 245, 24, t.dim,
                    { align: 'center', literal: true });
                cv.text('Soot, ash and regeneration distances are available in Overview',
                    800, 289, 19, t.dim, { align: 'center', literal: true });
                return;
            }
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
            const drawText = cv.text.bind(cv);
            cv.text = (value, x, y, size, colour, options) => {
                const opts = options || {};
                const text = opts.literal ? String(value) : translate(value);
                let available = opts.align === 'center' ? Math.min(x, W - x) * 2 - 32 : W - x - 24;
                if (page === 'about') available = x >= 1120 ? W - x - 24 : x === 640 ? 880 : 150;
                else if (page === 'detail' && size === 18) available = 700;
                else if (page === 'overview' && x > 1200) available = W - x - 24;
                const measured = cv.textWidth(text, size, { ...opts, literal: true });
                const fitted = measured > available ? size * available / measured : size;
                return drawText(text, x, y, fitted, colour, { ...opts, literal: true });
            };

            if (page === 'detail') {
                renderDetail(cv, t);
                G.frame(cv, t, TABS.map(label => translate(label)), 1, []);
                return ui.image('MAIN_GFX', cv);
            }
            if (page === 'about') {
                renderAbout(cv, t);
                G.frame(cv, t, TABS.map(label => translate(label)), 2, []);
                return ui.image('MAIN_GFX', cv);
            }

            const gutter = 16;
            const columnWidth = (W - 48 - 2 * gutter) * 0.4;
            const massX = 24;
            const distanceX = massX + columnWidth + gutter;
            const statusX = distanceX + columnWidth + gutter;
            const statusWidth = W - 24 - statusX;

            // Keep both rows below the kit's automatic panel stretch threshold.
            const gaugeHeight = 213;
            const loading = !readAttempted && (identifying || identified);

            function gauge(key, label, unit, max, step, tick, decimals, x, y, scaleDecimals = 0) {
                const reading = readings[key];
                const value = reading ? (unit === 'km' ? ddeProfiles.km(reading, profile.distanceFactor) : reading.value) : null;
                G.segBar(cv, t, x, y, columnWidth, gaugeHeight, {
                    label: translate(label), value, unit, decimals,
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

            const averageKm = profile && readings.AVERAGE
                ? ddeProfiles.km(readings.AVERAGE, profile.averageFactor) : 0;
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
            // Regeneration statuses are B57-only until B47 state bits are validated.
            const state = regenState();
            const inProgress = state === 'active';
            const statusText = inProgress ? 'IN PROGRESS' : state === 'requested' ? 'REQUESTED'
                : state === 'idle' ? 'NOT NEEDED' : 'UNKNOWN';
            const statusColor = inProgress ? t.ok : state === 'idle' ? t.dim : t.warn;
            cv.text(statusText, statusX + 18, 150, 30, statusColor, { font: 'bold' });

            const estimateAvailable = !inProgress && averageKm > 0 && !stale('AVERAGE')
                && hasReading('SINCE') && !stale('SINCE');
            const sinceKm = estimateAvailable ? ddeProfiles.km(readings.SINCE, profile.distanceFactor) : null;
            // Count down to the average interval; once exceeded, show +km beyond it.
            // The average is not a guaranteed regeneration trigger.
            const distanceToAverageKm = estimateAvailable ? averageKm - sinceKm : null;
            const distanceText = distanceToAverageKm === null ? '--'
                : (distanceToAverageKm < 0 ? '+' + (-distanceToAverageKm).toFixed(1)
                    : distanceToAverageKm.toFixed(1)) + ' km';
            cv.text('DISTANCE TO AVG REGEN', statusX + 18, 252, 16, t.dim, { font: 'bold' });
            cv.text('Countdown to average; +km after average',
                statusX + 18, 273, 12, t.dim);
            cv.text(distanceText, statusX + 18, 315, 42, t.text, { font: 'num' });
            if (estimateAvailable) {
                G.segBar(cv, t, statusX + 18, 342, statusWidth - 36, 26, {
                    panel: false, ramp: 'hot', min: 0, max: averageKm, step: averageKm / 12, value: sinceKm
                });
            }

            if (!hasMeasurements()) {
                cv.text(loading ? 'LOADING DPF DATA' : 'NO DPF DATA',
                    statusX + 18, 438, 18, loading ? t.dim : t.warn, { font: 'bold' });
            }

            G.frame(cv, t, TABS.map(label => translate(label)), 0, []);
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
            if (name === 'MAIN' && visible) refreshClusterEquipment().catch(error => log.warn('DPF Car Equipment: ' + error));
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
            let nextPageRead = 0;
            while (true) {
                const dataReady = page === 'detail' ? hasDetailMeasurements() : hasMeasurements();
                await sleep(5000);
                const pageVisible = page !== 'about' && ui.isVisible('MAIN');
                const clusterActive = clusterEnabled();
                if (testing || (!pageVisible && !clusterActive)) continue;
                if (!identified) await identify();
                if (!identified) continue;

                const now = Date.now();
                if (pageVisible && now >= nextPageRead) {
                    nextPageRead = now + (dataReady ? 60000 : 5000);
                    await testSelected();
                } else if (clusterActive) {
                    if (profile && profile.regeneration) await testSelected(true);
                }
            }
        })().catch(e => log.warn('DPF polling: ' + e));
        render()
            .then(() => log.info('DPF Status first frame rendered'))
            .catch((e) => log.warn('DPF Status first render: ' + e));
    }
});
