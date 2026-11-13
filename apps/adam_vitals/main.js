'use strict';
/**
 * Engine Vitals - M Vitals (apps/car_vitals 2.25.0) and Warm-Up (apps/warmup 1.7.3) in one app.
 *
 * Pages (tabs, or "Next page"): Main (boost, power, torque, gear, oil, coolant, transmission; while the engine
 * is cold the warm-up view takes its place until Hide or warm), Thermals, Fuel & ignition, Chassis, Warm-up, Cool
 * down; the kit adds Settings. One signal layer, one draw loop, one settings store (moved to this version once,
 * then checked at start: a bad saved value falls back to its default, logged once). Drawing: pages.js. Pure
 * logic: units.js, warmup.js, cooldown.js, settings_check.js.
 *
 * Every callback goes through safety.guard: nothing may throw out of the main loop (the kit exits on an
 * uncaught exception, and the car wipes then uninstalls an app that crashes). The only active car traffic is
 * the read-only poll of the engine unit (UDS 22 / OBD 01 / 06, as M Vitals) and of the gearbox unit (UDS 22 6000,
 * the transmission oil temperature, as Transmission Config / zf8hp), one request at a time: the DISABLE file
 * (path logged at start) or 5 errors in 10 s stop it. Nothing is sent to the cluster or HUD.
 * Wall-clock ages go through since(): a time stamp ahead of the clock (it was set back) counts as long ago,
 * so a reading is stale and a cadence runs at once (KB-ANY-204).
 */
const fs = require('fs');
const path = require('path');
const mgu = require('./kit/mgu');
const G = require('./kit/gauges');
const Engine = require('./kit/engine');
const { GearGuess, selectionOf } = require('./kit/car');
const { Diag } = require('./kit/diag');
const { DidReader } = require('./kit/dids');
const Demo = require('./demo');
const U = require('./units');
const Wu = require('./warmup');
const Cd = require('./cooldown');
const { clean, migrate } = require('./settings_check');
const { createSafety } = require('./safety');
const Pages = require('./pages');

const W = 1600, H = 520;
const PAGES = Pages.PAGES;
const FUEL = ['iat', 'hpfp', 'lpfp', 'timing', 'boostCtl', 'load'];   // engine unit values read fast on the Fuel & ignition page
const PAIR = { boostCtl: ['boostTarget', 'boostActual'], load: ['loadTarget', 'loadActual'] };
const HIST_SEC = 300, HIST5_MS = 5000, HIST5_N = 240, STATE_MS = 200, KILL_POLL_MS = 2000;
/* Transmission oil temperature from the gearbox unit: asked every TRANS_MS (on every page, so the warm-up sees it);
 * a reading older than TRANS_STALE_MS shows as no reading. 3 failed reads in a row: asked every 30 s (pollFuel). */
const TRANS_MS = 5000, TRANS_STALE_MS = 20000;
/* Plausible ranges (deg C / bar): a value outside is the car's "no data" marker, shown as no data. */
const TYRE_T = [-40, 150], TYRE_P = [0.5, 6], TYRE_PT = [1, 6];
const RANGE = {
    rpm: [0, 12000], coolant: [-40, 160], oil: [-40, 170], gearbox: [-40, 160], egs: [-40, 160], ambient: [-50, 60], timing: [-64, 64],
    boostFes: [-1, 4], boostDme: [-1, 4], boostTarget: [-1, 4], boostActual: [-1, 4], loadTarget: [0, 250], loadActual: [0, 250], tFL: TYRE_T, tFR: TYRE_T, tRL: TYRE_T, tRR: TYRE_T,
    pFL: TYRE_P, pFR: TYRE_P, pRL: TYRE_P, pRR: TYRE_P, ptFL: TYRE_PT, ptFR: TYRE_PT, ptRL: TYRE_PT, ptRR: TYRE_PT,
};
/* Fields some cars never fill sit at one number: they count once they changed this much (or seen.json says so). */
const MOVE = { gearbox: 1, egs: 1, boostFes: 0.03, boostDme: 0.03 };
const GROUP = { gearbox: 'gearbox', boostFes: 'boost', boostDme: 'boost', tFL: 'tyreTemp', tFR: 'tyreTemp', tRL: 'tyreTemp', tRR: 'tyreTemp',
    pFL: 'tyres', pFR: 'tyres', pRL: 'tyres', pRR: 'tyres', iat: 'iat', hpfp: 'hpfp', lpfp: 'lpfp', timing: 'timing', egs: 'egs',
    boostTarget: 'boostCtl', boostActual: 'boostCtl', loadTarget: 'load', loadActual: 'load' };
const SHOW = { gearbox: 'showGearbox', tyres: 'showTyres', tyreTemp: 'showTyreTemp', iat: 'showIat', hpfp: 'showHpfp', lpfp: 'showLpfp',
    timing: 'showTiming', misfire: 'showMisfire', egs: 'showEgs', boostCtl: 'showBoostCtl', load: 'showLoad' };
const GEARS = { G1: 1, G2: 2, G3: 3, G4: 4, G5: 5, G6: 6, G7: 7, G8: 8, G9: 9, G10: 10, R: -1, N_OR_P: 0 };
const gearOf = (x) => (typeof x === 'number' ? (x >= 3 && x <= 12 ? x - 2 : x === 1 ? -1 : x === 2 ? 0 : undefined) : GEARS[x]);
const STAGES = { P: 'P', R: 'R', N: 'N', D: 'D', 1: 'P', 2: 'R', 3: 'N', 4: 'D' };
const PROGRAMS = { S_MINUS_PROGRAMM: 'S', M_MINUS_PROGRAMM: 'M', 1: 'S', 2: 'M' };
const mono = () => { const h = process.hrtime(); return h[0] * 1000 + h[1] / 1e6; };
/** ms since a Date.now() stamp; 0 (never) or a stamp ahead of the clock (set back) is long ago (KB-ANY-204). */
const since = (t) => { const a = Date.now() - (t || 0); return a < 0 ? Infinity : a; };

/** Selector programme (D / S / M / P / R / N) from the gearbox status (Car Vitals' modeOf). */
function modeOf(o) {
    for (const k of Object.keys(o || {})) {
        if (k === 'statusActualGearDrive' || /StageDrive/.test(k) || !/select|lever|position|program|mode|range|manual|sport|tip/i.test(k)) continue;
        const v = o[k];
        if (v === true || v === 1) { if (/manual|tip/i.test(k)) return 'M'; if (/sport/i.test(k)) return 'S'; continue; }
        const x = String(v).toUpperCase();
        if (/NOT|INACTIVE|INVALID|SIGNAL|UNKNOWN|OFF|NO_/.test(x)) continue;
        if (/MANU|TIPP|^M$|^M_|_M$|^M\d/.test(x)) return 'M';
        if (/SPORT|^S$|_S$|^DS$/.test(x)) return 'S';
        if (/PARK|^P$/.test(x)) return 'P';
        if (/REVERSE|^R$/.test(x)) return 'R';
        if (/NEUTRAL|^N$/.test(x)) return 'N';
        if (/DRIVE|^D$|^D_|_D$/.test(x)) return 'D';
    }
    return null;
}

mgu.run({
    async start(ctx) {
        const { ui, settings, log } = ctx;
        try {
            const safety = createSafety({ cfg: { safety: { errorLimit: 5, errorWindowMs: 10000, killFile: 'DISABLE' } }, log });
            const guard = safety.guard, get = (k) => settings.get(k);
            const killPath = safety.killFile(ctx.dataDir);
            log.info('kill switch file (stops engine and gearbox unit reads): ' + killPath);
            let killed = safety.pollKill(fs, killPath);

            // settings saved by an older version moved to this one, once (0.2.0: oil and coolant warm at 220 F)
            migrate(settings.values, ctx.spec.settings).forEach((w) => {
                log.info('settings: ' + w[0] + ' ' + JSON.stringify(settings.get(w[0])) + ' -> ' + JSON.stringify(w[1]) + ' (moved to this version)');
                try { settings.set(w[0], w[1]); } catch (e) { log.warn('settings move ' + w[0] + ': ' + e); }
            });
            // saved settings checked once, before anything listens: a bad value goes back to its default (saved)
            const checked = clean(ctx.spec.settings, settings.values);
            checked.bad.forEach((k) => {
                log.warn('settings: bad saved ' + k + ' ' + JSON.stringify(settings.get(k)) + ', using the default ' + JSON.stringify(checked.values[k]));
                try { settings.set(k, checked.values[k]); } catch (e) { log.warn('settings fix ' + k + ': ' + e); }
            });

            const S = (ctx.spec.config && ctx.spec.config.scaling) || {};
            const sc = (k, raw) => {
                const c = S[k];
                if (!c || raw === undefined || raw === null || raw === c.invalid || (c.invalidFrom != null && raw >= c.invalidFrom)) return null;
                return raw * c.factor + (c.offset || 0);
            };
            /* The car's display units (Vehicle.statusNewCurrentUnitsStatusExt): tyre values come in them; also "Follow the car". */
            const carUnits = { press: null, temp: null, psiSeen: false };
            const PRESS_UNITS = { 1: 'BAR', 2: 'KPA', 3: 'PSI' }, TEMP_UNITS = { 1: 'C', 2: 'F' };
            const PRESS_TO_BAR = { BAR: 1, KPA: 0.01, PSI: 1 / 14.5038 };
            const unitName = (map, v) => (map[v] || (Object.keys(map).map((k) => map[k]).indexOf(v) >= 0 ? v : null));
            const units = () => U.resolve(get('units'), carUnits);
            const tyreP = (raw) => {
                const v = sc('tyrePress', raw);
                if (v === null) return null;
                const k = PRESS_TO_BAR[carUnits.press];
                if (k) return v * k;
                if (v >= TYRE_P[0] && v <= TYRE_P[1]) return v;
                if (v >= 7 && v < 60) { carUnits.psiSeen = true; return v / 14.5038; }
                if (v >= 60 && v <= 600) return v / 100;
                return v;
            };
            const tyreT = (raw) => {
                const v = sc('tyreTemp', raw), f = carUnits.temp ? carUnits.temp === 'F' : carUnits.psiSeen;
                return v !== null && f ? (v - 32) * 5 / 9 : v;
            };
            /* g-force: the offset an axis reads at a standstill is learned and taken off (Car Vitals). */
            const G0 = 9.80665, G_ZERO_MAX = 1, gZero = { gLong: { z: 0, n: 0 }, gLat: { z: 0, n: 0 } };
            let stillSince = 0;
            const standing = () => stillSince > 0 && since(stillSince) > 2000;
            const putG = (k, raw) => {
                const a = sc('accel', raw);
                if (a === null) return;
                const g = a / G0, z = gZero[k];
                if (standing() && Math.abs(g) <= G_ZERO_MAX) { z.n = Math.min(z.n + 1, 50); z.z += (g - z.z) / z.n; }
                put(k, g - z.z);
            };

            /* ---------- live data ---------- */
            const live = {}, peak = {}, demoPeak = {}, hist = { coolant: [], oil: [], gearbox: [], egs: [], ambient: [], iat: [], hpfp: [], lpfp: [], iatRise: [], timing: [],
                boostTarget: [], boostActual: [], loadTarget: [], loadActual: [] };
            const hist5 = [];       // [mono, oil, coolant, rpm, speed, boost, trans] every 5 s, 20 min (warm-up rate, cool-down trend)
            const peakAt = new Map();
            const raise = (o, k, v) => {
                if (!G.isNum(v)) return;
                const at = peakAt.get(o) || peakAt.set(o, {}).get(o), hold = get('peakHold') * 1000;
                if (o[k] === undefined || v >= o[k] || (hold > 0 && since(at[k]) > hold)) { o[k] = v; at[k] = Date.now(); }
            };
            const AWD_FILE = path.join(ctx.dataDir, 'awd.json'), SEEN_FILE = path.join(ctx.dataDir, 'seen.json');
            let awdSeen = false, seen = {};
            try { awdSeen = !!JSON.parse(fs.readFileSync(AWD_FILE, 'utf8')).seen; } catch (e) { /* not yet */ }
            try { seen = JSON.parse(fs.readFileSync(SEEN_FILE, 'utf8')) || {}; } catch (e) { /* not yet */ }
            if (!seen || typeof seen !== 'object') seen = {};
            const markAwd = () => {
                if (awdSeen) return;
                awdSeen = true; log.info('all-wheel drive detected');
                try { fs.writeFileSync(AWD_FILE, JSON.stringify({ seen: true })); } catch (e) { log.warn('awd save: ' + e); }
            };
            const remember = (keys) => {
                const add = keys.filter((x, i) => x && !seen[x] && keys.indexOf(x) === i);
                if (!add.length) return;
                add.forEach((x) => { seen[x] = true; });
                log.info('real data from the car: ' + add.join(', '));
                try { fs.writeFileSync(SEEN_FILE, JSON.stringify(seen)); } catch (e) { log.warn('seen save: ' + e); }
            };
            const bad = {}, first = {}, moved = {};
            const trusted = (k) => MOVE[k] == null || !!moved[k] || !!seen[k] || (/^t(FL|FR|RL|RR)$/.test(k) && !!seen.tyreTemp);
            const rawLogged = {};
            const logRaw = (name, raw) => {
                const key = JSON.stringify(raw), l = rawLogged[name] || (rawLogged[name] = []);
                if (l.length >= 12 || l.indexOf(key) >= 0) return;
                l.push(key); log.info('raw ' + name + ': ' + key);
            };
            let lastCar = 0, oilCarT = 0;
            const SPLIT_STALE = 10000;
            const SPLIT_OK = (q) => q === undefined || q === null || q === 2 || q === 10 ||
                q === 'SIGNALWERT_IST_GUELTIG' || q === 'SIGNALWERT_IST_GUELTIG__REKALIBRIERUNGSBEDARF';
            let splitAt = 0;
            const guess = new GearGuess();
            let gearLogs = 0, lastModeKey = '';
            const put = (k, v) => {
                if (v === null || v === undefined || !isFinite(v)) return;
                lastCar = Date.now();
                const r = RANGE[k];
                if (r && (v < r[0] || v > r[1])) { bad[k] = v; return; }
                delete bad[k];
                if (MOVE[k] != null) {
                    if (first[k] === undefined) first[k] = v;
                    else if (!moved[k] && Math.abs(v - first[k]) >= MOVE[k]) { moved[k] = true; remember([GROUP[k], k]); }
                } else if (GROUP[k]) remember([GROUP[k]]);
                live[k] = v;
                if (k === 'boostFes' || k === 'boostDme') { updBoost(); return; }
                raise(peak, k, v);
                if ((k === 'rpm' || k === 'torque') && G.isNum(live.torque) && G.isNum(live.rpm)) live.powerCalc = Math.max(0, live.torque * live.rpm / 9549);
                if (k === 'speed') stillSince = v < 0.5 ? stillSince || Date.now() : 0;
                if ((k === 'rpm' || k === 'speed') && G.isNum(live.rpm) && G.isNum(live.speed)) {
                    const g = guess.feed(live.rpm, live.speed);
                    live.gearGuess = live.speed < 3 ? null : g;     // a standstill can't tell P, N or D
                }
            };
            const engine = new Engine({ settings, dataDir: ctx.dataDir, log });
            const watches = [
                ['de.bmw.infotainment.vehicle.CDS', {
                    statusEngineSpeed2: (v) => put('rpm', sc('rpm', v.actualValueRPMEngineCrankshaft)),
                    statusEngineTemperature: (v) => {
                        logRaw('engine temperatures', [v.temperatureEngineDrive, v.temperatureEngineOilDrive]);
                        put('coolant', sc('engineTemp', v.temperatureEngineDrive));
                        const oil = sc('engineTemp', v.temperatureEngineOilDrive);
                        if (oil !== null) { oilCarT = Date.now(); put('oil', oil); }
                    },
                }],
                ['de.bmw.infotainment.vehicle.CDS2', {
                    statusLongitudinalAccelerationMassCenter: (v) => putG('gLong', v.longitudinalAccelerationCentreOfGravity),
                    statusLateralAccelerationMassCenter: (v) => putG('gLat', v.lateralAccelerationCentreOfGravity),
                }],
                ['de.bmw.infotainment.vehicle.Vehicle', {
                    statusNewCurrentUnitsStatusExt: (v) => {
                        const press = unitName(PRESS_UNITS, v && v.unitOfMeasurementAirPressure), temp = unitName(TEMP_UNITS, v && v.unitOfMeasurementTemperature);
                        if (press === carUnits.press && temp === carUnits.temp) return;
                        carUnits.press = press; carUnits.temp = temp;
                        log.info('car units: pressure ' + (press || '?') + ', temperature ' + (temp || '?'));
                    },
                }],
                ['de.bmw.infotainment.vehicle.Vehicle2', Object.assign({ statusCarSpeed2: (v) => put('speed', sc('speed', v.speedVehicleCentreOfGravity)) }, engine.handlers())],
                ['de.bmw.infotainment.drivingexcitement.FES', {
                    statusSwitchDriveDynamicSport2: (v) => { logRaw('FES boost', v.displayBoostPressure); put('boostFes', sc('boost', v.displayBoostPressure)); },
                    statusVehicleDynamicEngine: (v) => { put('powerPct', sc('sportPct', v.displaySportEnginePower)); put('torquePct', sc('sportPct', v.displaySportEngineTorque)); },
                    statusActualValueTorque2: (v) => { const tq = sc('torque', v.actualValueTorqueCrankshaft); put('torque', tq === null ? null : Math.max(0, tq)); },
                }],
                ['de.bmw.infrastructure.VehicleInformation', {
                    statusGearboxDrive: (v) => {
                        const g = gearOf(v && v.statusActualGearDrive);
                        if (g !== undefined) { live.gear = g; lastCar = Date.now(); }
                        live.stage = STAGES[v && v.statusActualStageDrive];
                        live.gearMode = modeOf(v);
                        const key = JSON.stringify(Object.keys(v || {}).filter((x) => x !== 'statusActualGearDrive').map((x) => [x, v[x]]));
                        if (key !== lastModeKey && gearLogs < 40) { gearLogs++; lastModeKey = key; log.info('gearbox: ' + JSON.stringify(v) + ' -> ' + (live.gearMode || '?')); }
                    },
                    DataPowerTrain2: (v) => {
                        logRaw('gear selection', v && v.statusGearSelectionDrive);
                        const sel = selectionOf(v && v.statusGearSelectionDrive);
                        if (!sel) return;
                        if (sel.stage !== undefined) live.stage = sel.stage;
                        live.gear = sel.gear; lastCar = Date.now();
                    },
                }],
                ['de.bmw.infrastructure.analytics.BasicDataSet', {
                    basicDataSet: (v) => {
                        logRaw('gearbox oil', v.valueTemperatureTransmissionOil);
                        put('gearbox', sc('gearboxTemp', v.valueTemperatureTransmissionOil));
                        const rawSplit = v.valueDistributionLongitudinalTorqueRearAxisFrontAxis, q = v.qualifierValueDistributionLongitudinalTorqueRearAxisFrontAxis;
                        logRaw('torque split [value, qualifier]', [rawSplit, q]);
                        const split = SPLIT_OK(q) ? sc('torqueSplitRear', rawSplit) : null;
                        if (G.isNum(split) && split > 0) { put('splitRear', split); splitAt = Date.now(); }
                        if (G.isNum(split) && split > 1 && split < 97) markAwd();
                    },
                }],
                ['de.bmw.infrastructure.EnvironmentalInformation', { ExteriorTemperature: (v) => put('ambient', sc('ambient', v.temperatureExterior)) }],
                ['de.bmw.infotainment.vehicle.TPMS', {
                    statusTyreTemperature: (v) => {
                        logRaw('tyre temperature', [v.actualValueTemperatureTyreFLH, v.actualValueTemperatureTyreFRH, v.actualValueTemperatureTyreRLH, v.actualValueTemperatureTyreRRH]);
                        put('tFL', tyreT(v.actualValueTemperatureTyreFLH)); put('tFR', tyreT(v.actualValueTemperatureTyreFRH));
                        put('tRL', tyreT(v.actualValueTemperatureTyreRLH)); put('tRR', tyreT(v.actualValueTemperatureTyreRRH));
                    },
                    statusTyrePressure: (v) => {
                        logRaw('tyre pressure', [v.actualValuePressureTyreFLH, v.actualValuePressureTyreFRH, v.actualValuePressureTyreRLH, v.actualValuePressureTyreRRH]);
                        put('pFL', tyreP(v.actualValuePressureTyreFLH)); put('pFR', tyreP(v.actualValuePressureTyreFRH));
                        put('pRL', tyreP(v.actualValuePressureTyreRLH)); put('pRR', tyreP(v.actualValuePressureTyreRRH));
                    },
                    statusTargetTyrePressure: (v) => {
                        put('ptFL', tyreP(v.targetPressureTyreFLH)); put('ptFR', tyreP(v.targetPressureTyreFRH));
                        put('ptRL', tyreP(v.targetPressureTyreRLH)); put('ptRR', tyreP(v.targetPressureTyreRRH));
                    },
                }],
                ['de.bmw.infotainment.misc.MDrive', {
                    statusMSystem: (v) => { live.awd = v.statusAllWheelSetup; live.awdQual = v.qualifierFunctionAllWheel; if (/^_4WD|SAND/.test(String(live.awd))) markAwd(); },
                    dataDisplayGearbox: (v) => { logRaw('gear programme', v && v.displayProgramGearbox); live.program = PROGRAMS[v && v.displayProgramGearbox] || null; },
                }],
            ];
            // every handler guarded: a malformed sample is logged and counted, never thrown into the signal layer
            const guarded = (iface, h) => {
                const o = {};
                Object.keys(h).forEach((k) => { o[k] = guard(iface.split('.').pop() + '.' + k, h[k]); });
                return o;
            };
            log.info('subscribing signals');
            const subs = [], startT = Date.now();
            Promise.all(watches.map((w) => ctx.signals.watch(w[0], '1', guarded(w[0], w[1]), log, /\.TPMS$/.test(w[0]) ? { pollMs: 10000 } : undefined)
                .then((s) => { subs.push(s); return s; })))
                .then(guard('signals', (all) => log.info('signals: ' + all.map((s) => s.iface.split('.').pop() + (s.error ? '(err)' : '')).join(' '))), (e) => log.warn('signals: ' + (e && e.stack || e)));

            const demo = new Demo();
            demo.setRedline(engine.redline());
            engine.onChange(guard('engine', () => demo.setRedline(engine.redline())));
            const carPresent = () => lastCar > 0 || subs.some((s) => s.available);
            const usingDemo = () => get('demo') === 'on' || (get('demo') === 'auto' && !carPresent() && since(startT) > 5000);
            const transFresh = () => get(SHOW.egs) !== 'off' && !!fuelT.egs && since(fuelT.egs) < TRANS_STALE_MS;
            const data = () => {
                if (usingDemo()) return demo.sample();
                const v = Object.assign({}, live);
                Object.keys(MOVE).forEach((k) => { if (!trusted(k)) v[k] = null; });
                if (!transFresh()) v.egs = null;           // an old gearbox reading is no reading, never a stale number
                return v;
            };
            /* Transmission oil temperature (deg C) for the warm-up and the pages: the gearbox unit's 22 6000, fresh and changed
             * once (MOVE; data() drops it when stale or set to Hide), or the demo's; null when there is none (shown as --, it
             * then neither blocks nor counts). */
            const trans = (d) => (G.isNum(d.egs) ? d.egs : null);
            /** Shown on Warm-up / Main / Cool down: Show always; Auto once this car's gearbox answered (or in demo). */
            const transShown = () => { const s = get(SHOW.egs); return s === 'on' || (s !== 'off' && (usingDemo() || !!seen.egs)); };
            function updBoost() {
                const src = get('boostSource');
                const fes = G.isNum(live.boostFes) ? live.boostFes : null, dmeB = G.isNum(live.boostDme) ? live.boostDme : null;
                const v = src === 'fes' ? fes : src === 'dme' ? dmeB : fes !== null && trusted('boostFes') ? fes : dmeB !== null && trusted('boostDme') ? dmeB : null;
                live.boost = v;
                if (v !== null) raise(peak, 'boost', v);
            }
            const boostFromDme = () => (dme.boost || []).length > 0 && (get('boostSource') === 'dme'
                || (get('boostSource') !== 'fes' && !(G.isNum(live.boostFes) && trusted('boostFes'))));
            const shown = (g) => { const s = get(SHOW[g]); return s === 'on' || (s !== 'off' && (usingDemo() || !!seen[g])); };
            function why(k) {
                const u = units(), f = (c) => G.fmt(U.T(c, u), 0) + U.tU(u);
                if (bad[k] !== undefined) return 'car sends ' + f(bad[k]) + ' - not a real value';
                if (G.isNum(live[k]) && !trusted(k)) return 'stuck at ' + f(live[k]) + ' - waiting for it to change';
                return 'no data from the car';
            }

            /* ---------- engine unit reads (UDS 22 / OBD; app.json config.dme): read only, off with the kill file ---------- */
            const dme = Object.assign({ ecu: 18 }, (ctx.spec.config && ctx.spec.config.dme) || {});
            const link = new Diag(ctx.signals, log);
            link.quiet = true;
            link.init();
            const rd = new DidReader(link, { ecu: dme.ecu });
            const xcfg = Object.assign({ front: [], gearRatios: [] }, (ctx.spec.config && ctx.spec.config.xdrive) || {});
            let chassisSeen = 0, lmvAt = 0;
            const fuelT = {}, fuelFail = {}, fuelTry = {};
            let fuelSeen = 0, engineSeen = 0, fuelTimer = null, fuelBusy = false, fuelLast = 0, baro = 101.3, baroT = 0, misMode = null, misCyl = 0;
            const readsOff = () => killed || safety.tripped();
            async function readMisfire() {
                const m = dme.misfire || {}, ecu = m.ecu == null ? dme.ecu : m.ecu, tid = parseInt(m.tid || '0C', 16);
                if (misMode === null) {
                    if (await rd.monitor(ecu, 0xA2, false)) misMode = false;
                    else if (await rd.monitor(ecu, 0xA2, true)) misMode = true;
                    else return null;
                }
                if (!misCyl) {
                    const sup = await rd.supported(ecu, 0xA0, misMode);
                    let n = 0;
                    while (sup && n < 12 && sup.indexOf(0xA2 + n) >= 0) n++;
                    if (n) { misCyl = n; log.info('misfire counter: ' + n + ' cylinders (engine unit list)'); }
                }
                const counts = [];
                for (let c = 0; c < (misCyl || 12); c++) {
                    const res = await rd.monitor(ecu, 0xA2 + c, misMode);
                    if (!res) {
                        if (misCyl || !c || !/^NRC/.test(rd.raws[rd.monitorKey(ecu, 0xA2 + c, misMode)].why)) return null;
                        break;
                    }
                    const tr = res.find((x) => x.tid === tid) || res[0];
                    counts.push(tr.value >= 65535 ? null : tr.value);
                }
                if (!misCyl) { misCyl = counts.length; log.info('misfire counter: ' + misCyl + ' cylinders (counted)'); }
                return counts.length === misCyl ? counts : null;
            }
            async function freshBaro() {
                if (since(baroT) > 60000) { baroT = Date.now(); const b = await rd.value('baro', dme.baro); if (b !== null) baro = b; }
            }
            /** The gearbox unit's replies to the log (first 12 different ones per DID): what the car answers, for the car day. */
            const logEgs = () => (dme.egs || []).forEach((c) => {
                const r = rd.raws[rd.key(c)];
                if (r) logRaw('EGS ' + DidReader.label(c), r.ok ? r.bytes : r.why + (r.bytes ? ' (' + r.bytes + ')' : ''));
            });
            /** Once, with the first transmission read: which gearbox unit this is (22 F150), logged, never a gate. */
            let egsIdDone = !(dme.egsId || []).length;
            async function logEgsId() {
                egsIdDone = true;
                const v = await rd.value('egsId', dme.egsId);
                log.info('gearbox unit identification (22 F150): ' + (v === null ? 'no answer' : Math.round(v).toString(16).toUpperCase().padStart(6, '0'))
                    + ' (Transmission Config decodes 0F25D0, G22, and 0F21E0)');
            }
            async function readBoost() {
                await freshBaro();
                const m = await rd.value('boost', dme.boost);
                return m === null ? null : (m - baro) / 100;
            }
            async function readPair(k) {
                const tk = PAIR[k][0], ak = PAIR[k][1];
                let target = await rd.value(tk, dme[tk]);
                if (target === null) return null;
                let actual = await rd.value(ak, dme[ak]);
                if (k === 'boostCtl') {
                    await freshBaro();
                    target = (target - baro) / 100;
                    actual = actual === null ? null : (actual - baro) / 100;
                }
                return { target, actual };
            }
            async function readLmv() {
                const v = await rd.value('lmvFront', xcfg.front);
                if (v === null) { fuelFail.lmv = (fuelFail.lmv || 0) + 1; return; }
                fuelFail.lmv = 0;
                live.lmvFront = v; lmvAt = Date.now(); lastCar = lmvAt;
                if (v > 20) markAwd();
            }
            /* Fast (~2/s) for the page on screen, all every 5 s otherwise so the history keeps filling. */
            async function pollFuel() {
                fuelBusy = true; fuelLast = Date.now();
                let fast = null;
                try {
                    if (readsOff()) return;
                    const needBoost = boostFromDme();
                    const needOil = (dme.oil || []).length > 0 && since(oilCarT) > 15000;     // oil from the engine unit while the car sends none
                    const want = (k) => get(SHOW[k]) !== 'off' && (k === 'misfire' ? !!dme.misfire : (dme[PAIR[k] ? PAIR[k][0] : k] || []).length > 0);
                    const onFuelPage = since(fuelSeen) < 1500;
                    const onChassis = since(chassisSeen) < 1500 && xcfg.front.length > 0 && get('xdrive') !== 'off' && !(G.isNum(live.splitRear) && since(splitAt) < SPLIT_STALE);
                    fast = onFuelPage ? FUEL.filter(want) : since(engineSeen) < 1500 && needBoost ? ['boost'] : onChassis ? ['lmv'] : null;
                    pollFuel.n = (pollFuel.n || 0) + 1;
                    const misNow = want('misfire') && (!fast || (onFuelPage && pollFuel.n % 4 === 0));
                    const transNow = want('egs') && since(fuelTry.egs) >= TRANS_MS;      // the gearbox: every TRANS_MS, fast or slow
                    if (!link.available) return;
                    const keys = (fast || FUEL.filter(want).concat(needBoost ? ['boost'] : [], needOil ? ['oil'] : [])).concat(transNow ? ['egs'] : [], misNow ? ['misfire'] : []);
                    for (const k of keys) {
                        if (readsOff()) break;
                        if ((fuelFail[k] || 0) >= 3 && since(fuelTry[k]) < 30000) continue;
                        fuelTry[k] = Date.now();
                        if (k === 'lmv') { await readLmv(); continue; }
                        const v = k === 'boost' ? await readBoost() : k === 'misfire' ? await readMisfire() : PAIR[k] ? await readPair(k) : await rd.value(k, dme[k]);
                        if (k === 'egs') { logEgs(); if (!egsIdDone && !readsOff()) await logEgsId(); }
                        if (k === 'oil' && v !== null && since(oilCarT) < 15000) continue;
                        if (v === null) { fuelFail[k] = (fuelFail[k] || 0) + 1; continue; }
                        fuelT[k] = Date.now(); fuelFail[k] = 0;
                        if (k === 'misfire') { logRaw('misfires', v); live.misfire = v; lastCar = Date.now(); remember(['misfire']); }
                        else if (PAIR[k]) { put(PAIR[k][0], v.target); if (v.actual !== null) put(PAIR[k][1], v.actual); else delete live[PAIR[k][1]]; }
                        else put(k === 'boost' ? 'boostDme' : k, v);
                    }
                } catch (e) {
                    log.warn('engine unit poll: ' + e);
                } finally {
                    fuelBusy = false;
                    fuelTimer = setTimeout(pollGuarded, fast && !readsOff() ? 400 : 5000);
                }
            }
            const pollGuarded = guard('engine unit poll', pollFuel);
            fuelTimer = setTimeout(pollGuarded, 1000);
            const kickFuel = () => { if (!readsOff() && !fuelBusy && since(fuelLast) > 600) { clearTimeout(fuelTimer); fuelTimer = setTimeout(pollGuarded, 0); } };
            function fuelWhy(k) {
                if (killed) return 'engine unit reads off (DISABLE file)';
                if (safety.tripped()) return 'engine unit reads stopped after errors';
                if (!link.p) return 'no diagnostic link';
                if (!link.available) return 'diagnostic link down';
                const r = k === 'misfire' ? Object.keys(rd.raws).filter((x) => /MID A2|F6A2/.test(x)).map((x) => rd.raws[x])
                    : (dme[PAIR[k] ? PAIR[k][0] : k] || []).map((c) => rd.raws[rd.key(c)]).filter(Boolean);
                if (!r.length) return 'reading...';
                if (r.every((x) => /NRC 31|NRC 11|NRC 12/.test(x.why))) return 'not available on this car';
                if (k === 'misfire' && misMode === null) return 'not available on this car';
                return /NRC|refused|reply/.test(r[0].why) ? 'no reading from the engine unit' : r[0].why || 'no data';
            }
            function boostWhy() {
                const src = get('boostSource');
                const dmeMsg = readsOff() ? 'engine unit reads off' : !link.p ? 'no diagnostic link' : !link.available ? 'diagnostic link down' : fuelFail.boost ? 'engine unit: no boost DID answers' : 'engine unit: reading...';
                if (src === 'fes') return bad.boostFes !== undefined ? 'sport display sends ' + G.fmt(bad.boostFes, 2) + ' - not a real value' : 'no boost from the sport display';
                if (src === 'dme') return dmeMsg;
                return 'sport display: ' + (G.isNum(live.boostFes) ? 'not changing' : 'nothing') + '  ·  ' + dmeMsg;
            }
            /** Why the transmission temperature shows as -- (Warm-up, Main, Thermals). */
            function transWhy() {
                if (get(SHOW.egs) === 'off') return 'off in Settings';
                if (G.isNum(live.egs) && transFresh() && !trusted('egs')) return 'waiting for it to change';
                if (fuelT.egs && !transFresh()) return 'gearbox unit: no reading for ' + Math.round(TRANS_STALE_MS / 1000) + ' s';
                return fuelWhy('egs').replace('engine unit', 'gearbox unit');
            }
            const fuelOk = (k) => usingDemo() || (fuelT[k] && since(fuelT[k]) < 15000);
            const xdriveSplit = (d) => {
                if (usingDemo()) return { rear: d.splitRear, from: null };
                if (G.isNum(live.splitRear) && since(splitAt) < SPLIT_STALE) return { rear: live.splitRear, from: null };
                if (G.isNum(live.lmvFront) && since(lmvAt) < 3000) {
                    const nm = live.lmvFront, ratio = xcfg.gearRatios[(live.gear || 0) - 1];
                    const input = G.isNum(live.torque) && ratio ? live.torque * ratio : null;
                    if (nm <= 5) return { rear: 100, from: 'transfer case: clutch open', nm };
                    if (input > 50) return { rear: 100 - Math.max(0, Math.min(100, nm / input * 100)), from: 'transfer case, estimated', nm };
                    return { rear: null, from: 'transfer case', nm };
                }
                if (d.awd === '_2WD') return { rear: 100, from: '2WD mode' };
                return { rear: null, from: null };
            };
            /** Power in kW: { kw, calc } (calc = torque x rpm, no sport-display data). */
            function power(d) {
                if (get('powerSource') !== 'calc' && G.isNum(d.powerPct)) return { kw: d.powerPct / 100 * get('maxPower'), calc: false };
                return { kw: G.isNum(d.powerCalc) ? d.powerCalc : null, calc: true };
            }

            /* ---------- history: 1 Hz traces (Thermals, Fuel) and the 5 s rows (warm-up rate, cool-down trend) ---------- */
            let last5 = 0;
            setInterval(guard('history', () => {
                const d = data();
                Object.keys(hist).forEach((k) => {
                    let v = d[k] == null ? null : d[k];
                    const fk = GROUP[k] && PAIR[GROUP[k]] ? GROUP[k] : k;
                    if (FUEL.indexOf(fk) >= 0 && !fuelOk(fk)) v = null;
                    if (k === 'iatRise') v = fuelOk('iat') && G.isNum(d.iat) && G.isNum(d.ambient) ? d.iat - d.ambient : null;
                    hist[k].push(v); if (hist[k].length > HIST_SEC) hist[k].shift();
                });
                const m = mono(), tr = trans(d);
                if (m - last5 >= HIST5_MS && (G.isNum(d.oil) || G.isNum(d.coolant) || G.isNum(tr))) {
                    last5 = m; hist5.push([m, d.oil, d.coolant, d.rpm, d.speed, d.boost, tr]);
                    while (hist5.length > HIST5_N) hist5.shift();
                }
            }), 1000);

            /* ---------- warm-up takeover + cool-down: stepped on a timer, so they run while the screen is hidden ---------- */
            let page = Math.max(0, PAGES.indexOf(get('page')));
            let take = Wu.init(), cool = Cd.init(), lastStep = 0, lastReason = '', lastCool = '';
            const enabled = () => get('showWarmup') !== false;
            const logTakeover = () => {
                const r = Wu.reason(take, enabled());
                if (r === lastReason) return;
                const was = lastReason; lastReason = r;
                if (r === 'shown') log.info('warm-up view shown');
                else if (was === 'shown' || was === '') log.info('warm-up view hidden: ' + r);
                else log.info('warm-up view hidden: ' + r + ' (was ' + was + ')');
            };
            function stepState() {
                const d = data(), m = mono(), dt = lastStep ? (m - lastStep) / 1000 : 0;
                lastStep = m;
                // the transmission counts only with its setting on and a reading (none: it neither blocks nor counts)
                const tr = get('transWarmup') !== false ? trans(d) : null;
                const settled = (k, v, mark) => Wu.eta(k, v, mark, d, hist5).state === 'stalled';
                take = Wu.step(take, { oil: d.oil, coolant: d.coolant, trans: tr, rpm: d.rpm,
                    warmOil: get('warmOil'), warmCoolant: get('warmCoolant'), warmTrans: get('warmTrans'),
                    settled: { coolant: settled('coolant', d.coolant, get('warmCoolant')), trans: settled('trans', tr, get('warmTrans')) },
                    now: m, wall: Date.now() });
                cool = Cd.step(cool, { rpm: d.rpm, kw: power(d).kw, boost: d.boost, speed: d.speed }, dt, m);
                logTakeover();
                const a = Cd.advice(cool, { rpm: d.rpm, speed: d.speed, kw: power(d).kw });
                if (a.state !== lastCool) { lastCool = a.state; log.info('cool-down: ' + a.state + (a.need ? ' (needs ' + Math.ceil(a.need) + ' s, ' + Math.ceil(a.left) + ' s left)' : '')); }
            }
            setInterval(guard('state', stepState), STATE_MS);
            const dismiss = () => {
                if (!take.cold || take.dismissed) return;
                take = Wu.dismiss(take); logTakeover();
                return render();
            };

            setInterval(guard('kill', () => {
                const k = safety.pollKill(fs, killPath);
                if (k !== killed) { killed = k; log.warn(k ? 'kill file found: engine unit reads off' : 'kill file gone: engine unit reads allowed'); }
            }), KILL_POLL_MS);

            /* ---------- drawing ---------- */
            const trail = [];
            const pages = Pages.create({
                settings, live, hist, peak, demoPeak, trail, raise, units, usingDemo, shown, why, fuelWhy, boostWhy, power, xdriveSplit, mono,
                trans, transShown, transWhy,
                awdSeen: () => awdSeen, hist5: () => hist5, takeover: () => take, dismiss: guard('hide warm-up', dismiss),
                takeoverShown: () => Wu.show(take, { enabled: enabled(), page: PAGES[page] }),
                coolAdvice: (d) => Cd.advice(cool, { rpm: d.rpm, speed: d.speed, kw: power(d).kw }),
                limit: (oil) => Wu.limit(oil, get('warmOil'), engine.redline(), engine.value('coldLimit', { diesel: 3000, petrol: 3500 })),
                redline: () => engine.redline(),
                oilFromDme: () => !usingDemo() && since(oilCarT) > 15000 && !!fuelT.oil && since(fuelT.oil) < 15000,
                fuelVal: (d) => (k) => (fuelOk(GROUP[k] && PAIR[GROUP[k]] ? GROUP[k] : k) ? d[k] : null),
                misfires: (d) => (usingDemo() ? d.misfire : fuelT.misfire && since(fuelT.misfire) < 30000 ? live.misfire : null),
                banner: () => (killed ? 'Engine unit reads off (DISABLE file)' : safety.tripped() ? 'Engine unit reads stopped after errors' : ''),
                onEngine: () => { engineSeen = Date.now(); if (boostFromDme()) kickFuel(); },
                onFuel: () => { fuelSeen = Date.now(); kickFuel(); },
                onChassis: () => { chassisSeen = Date.now(); kickFuel(); },
            });
            async function render() {
                const t = ctx.theme(), d = data();
                const cv = ctx.canvas(W, H).clear(t.bg);
                pages.draw(page, cv, t, d);
                G.frame(cv, t, Pages.TABS, page, [usingDemo() && { text: 'DEMO' }, killed && { text: 'OFF' }, safety.tripped() && { text: 'STOPPED' }]);
                if (!render.n) { render.n = 1; log.info('first frame drawn'); }
                await ui.image('MAIN_GFX', cv);
            }
            const draw = guard('draw', render);
            const goto = (i) => { page = ((i % PAGES.length) + PAGES.length) % PAGES.length; return draw(); };

            ui.onClick('BTN_PAGE', guard('next page', () => goto(page + 1)));
            ui.onClick('BTN_PREV', guard('previous page', () => goto(page - 1)));
            ui.onClick('BTN_HIDE_WARMUP', guard('hide warm-up', dismiss));
            if (ctx.hideButton) ctx.hideButton('BTN_HIDE_WARMUP');      // drawn on the page where the kit runs the screen
            ctx.onTab(guard('tab', (i) => (i >= 0 && i < PAGES.length ? goto(i) : null)));
            ctx.loop('MAIN', 10, draw);
            settings.onChange(guard('settings', (k) => {
                if (k === 'maxPower' || k === 'powerSource') { delete peak.power; delete demoPeak.power; }
                if (k === 'boostSource') { delete peak.boost; updBoost(); }
                if (k === 'page') page = Math.max(0, PAGES.indexOf(get('page')));
                if (['showWarmup', 'warmOil', 'warmCoolant', 'warmTrans', 'transWarmup', SHOW.egs].indexOf(k) >= 0) { stepState(); logTakeover(); }
            }));
            stepState();
            log.info('started: units ' + get('units') + ' -> ' + JSON.stringify(units()) + ', page ' + PAGES[page]);
            const t0 = Date.now();
            draw().then(() => log.info('first frame done ' + (Date.now() - t0) + ' ms'));
        } catch (e) {
            log.error('start: ' + (e && e.stack || e));
        }
    },
});
