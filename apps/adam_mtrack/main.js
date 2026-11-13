'use strict';
/**
 * M Track Cluster - an M Track style cover over the instrument cluster (the cluster-render service's `panel`
 * target, 1920 x 720): bar tachs to 7,000 rpm, gear over speed in mph, side panels, corner gauges, shift-light
 * slats. It covers the real speedometer, so it shows only while every guard holds (logic.decide): the cover is on,
 * the drive mode is allowed, a valid speed arrived within the speed timeout (1 s), no BMW popup (when the car sends
 * that signal, Safety > BMW popups), BMW does not hold the panel, no kill file, no recent error, live data. Any of
 * them failing drops every layer within one tick (100 ms), a build under way too. The cover is built stage by stage
 * (output.js, stages.js: each layer confirmed by cluster-render's status before the next) and shown with u_alive 1,
 * re-armed by a renderer animation (G's Dash's dead-man: a hung app's cover fades by itself when the KOMBI plays it); a
 * crashed or exited app's connection closes and the service drops its layers at once. Default off.
 * Centre screen: the settings pages (ui.js), drawn only when something changes (a setting, the cover's reason, a
 * signal's status on the Safety page: present / missing / stale). Every callback goes through
 * safety.guard: nothing may throw out of the main loop (three app crashes in ~33 s wipe every app).
 * Tunables: config.js. Pure parts: logic.js, geom.js, units.js, widgets.js.
 */
const fs = require('fs');
const path = require('path');
const mgu = require('./kit/mgu');
const Car = require('./kit/car');
const L = require('./logic');
const G = require('./geom');
const U = require('./units');
const W = require('./widgets');
const CAT = require('./catalogue');
const { createSafety } = require('./safety');
const { createOutput } = require('./output');
const { createLadder } = require('./ladder');
const ST = require('./stages');
const { createDiag } = require('./diaglog');
const RD = require('./renderer');
const { createPoll } = require('./poll');
const { ClusterRender } = require('./cluster_render_client');
const { Canvas } = require('./kit/canvas');
const { createUi } = require('./ui');
const P = require('./pages');

const CDS = 'de.bmw.infotainment.vehicle.CDS', V2 = 'de.bmw.infotainment.vehicle.Vehicle2';
const FES = 'de.bmw.infotainment.drivingexcitement.FES', TPMS = 'de.bmw.infotainment.vehicle.TPMS';
const KOMBI = 'de.bmw.infotainment.KombiIF', ENV = 'de.bmw.infrastructure.EnvironmentalInformation';
const VEH = 'de.bmw.infotainment.vehicle.Vehicle', CCM = 'de.bmw.infotainment.checkcontrol.CheckControlMaster';
const KI2 = 'de.bmw.infotainment.KombiInterface_2', VI = 'de.bmw.infrastructure.VehicleInformation';
const PRESS_UNITS = { 1: 'BAR', 2: 'KPA', 3: 'PSI', BAR: 'BAR', KPA: 'KPA', PSI: 'PSI' }, TEMP_UNITS = { 1: 'C', 2: 'F', C: 'C', F: 'F' };
const CONS_L100 = { 1: (x) => x, 2: (x) => 282.481 / x, 3: (x) => 235.215 / x, 4: (x) => 100 / x,
    VERBRAUCH_IN_L_S_100KM: (x) => x, VERBRAUCH_IN_MPG_UK: (x) => 282.481 / x, VERBRAUCH_IN_MPG_US: (x) => 235.215 / x, VERBRAUCH_IN_KM_S_L: (x) => 100 / x };
const SPEED_KMH = { 1: 1, 2: U.KM_PER_MI, KM_S_H__KM: 1, MPH__MLS: U.KM_PER_MI };
const isNum = U.isNum;

mgu.run({
    async start(ctx) {
        const { ui, settings, log } = ctx;
        try {
            const cfg = require('./config');
            const safety = createSafety({ cfg, log });
            const guard = safety.guard;
            const killPath = safety.killFile(ctx.dataDir);
            log.info('kill switch file: ' + killPath);
            // what was sent to cluster-render and what came back, every release check and test step (tools/car-logs.sh)
            const diag = createDiag(ctx.dataDir, cfg.diagLogKb);
            log.info('diagnostic log: ' + diag.file);
            diag('start: M Track ' + ((ctx.spec && ctx.spec.version) || '?') + ', node ' + process.version + ', kill file ' + killPath);
            const get = (k) => settings.get(k);
            const schema = settings.schema || (ctx.spec && ctx.spec.settings) || [];
            const moves = L.migrateSettings(get, schema);
            moves.forEach((w) => { try { settings.set(w[0], w[1]); } catch (e) { log.warn('settings migration ' + w[0] + ': ' + e); } });
            if (moves.length) log.info('settings migrated to v' + L.SETTINGS_V + ': ' + JSON.stringify(moves));
            const warned = Object.create(null);
            const read = () => {
                const r = L.readSettings(get, schema);
                r.bad.forEach((k) => { if (!warned[k]) { warned[k] = true; log.warn('settings: ' + k + ' was not valid, using ' + JSON.stringify(r.values[k])); } });
                return r.values;
            };
            let v = read();

            // the art: one deflated json in the app's art folder (art.pack on the car); without it the cover never arms
            let art = null;
            try { art = require('./kit/pack').open(path.join(__dirname, 'art')).json('art.json'); } catch (e) { art = null; }
            const artOk = !!(art && art.items && art.atlas);
            if (!artOk) log.error('art/art.json is missing or damaged: the cover stays off');
            const sc = (k, raw) => {
                const c = cfg.scaling[k];
                if (!c || !isNum(raw) || raw === c.invalid || (c.invalidFrom !== undefined && raw >= c.invalidFrom)) return null;
                return raw * c.factor + c.offset;
            };

            /* ---------- car state ---------- */
            let carMode = null, modeRaw, d = {}, speedAt = null, speedKmh = null, killed = safety.pollKill(fs, killPath);
            const carUnits = { press: null, temp: null };
            const cc = { active: new Set(), newAt: null };
            const vals = { tyres: { p: [], t: [] }, trip: {}, timer: null, peaks: { right: 0, brake: 0, left: 0, accel: 0 }, boost: null, fuelL: null, rangeKm: null, ambient: null };
            const seen = Object.create(null), watchRes = Object.create(null);
            const units = () => U.resolve(v.units, carUnits);
            const ifaceUp = (i) => !!(seen[i] || (watchRes[i] && watchRes[i].available));
            const avail = (id) => { const w = CAT.get(id); return !!w && w.needs.every(ifaceUp); };
            // monotonic on purpose: the startup wait for a signal must not stretch or shrink with a wall-clock jump
            const started = process.hrtime();
            const upMs = () => { const t = process.hrtime(started); return t[0] * 1e3 + t[1] / 1e6; };
            /**
             * A signal's interface: 'present' (the car answered or sent it), 'waiting' (its watch has not settled, in
             * the first signalWaitMs), 'unoffered' (no SOME/IP config for it on this unit, or the watch failed),
             * 'missing' (no answer). Missing and present-but-idle stay apart: an idle Check Control list is present.
             */
            const ifaceState = (i) => {
                if (ifaceUp(i)) return 'present';
                if (watchRes[i] && watchRes[i].error) return 'unoffered';
                return watchRes[i] || upMs() >= cfg.safety.signalWaitMs ? 'missing' : 'waiting';
            };
            // emulator hooks (emufeed.js, never on a car): the handlers each interface was watched with, a speed block
            const hooks = { handlers: Object.create(null), blockSpeed: false };

            const crSocket = process.env.MTRACK_CR_SOCKET || undefined;
            const output = createOutput({
                ClusterRender, socketPath: crSocket, log, cfg, guard, art: art || {}, diag,
                fault: (msg) => guard('cluster-render', () => { throw new Error(msg); })(),
            });
            // a closed connection's release, checked by a watcher that never makes a layer (renderer.verifyRelease)
            const verify = (why, done) => RD.verifyRelease({ ClusterRender, socketPath: crSocket, log, diag, guard, cfg }, why, done);
            let ladder = null, release = null;
            function checkRelease(why) { release = { pending: true, why }; verify(why, (v) => { release = v; changed(); }); }

            // speed: alive = a valid value (not 65535) within speedStaleMs, notified or polled with the getter
            const speedIn = (x) => {
                if (hooks.blockSpeed) return false;
                const k = sc('speedRaw', x && x.speedVehicleCentreOfGravity);
                if (k !== null) { speedAt = Date.now(); speedKmh = k; }
                return true;
            };
            // the getter is polled while the cover is armed, a test step runs or the Safety tab is open (parked() needs it)
            const speedPoll = createPoll({ field: 'statusCarSpeed2', name: 'speed', cfg: cfg.speedPoll, log,
                enabled: () => output.status().armed || !!(ladder && ladder.running()) || (pages.page() === 3 && ui.isVisible('MAIN')) });
            const rpmPoll = createPoll({ field: 'statusEngineSpeed2', name: 'rpm', cfg: cfg.rpmPoll, log, enabled: () => output.status().shown && !d.demo });
            const watched = [];
            // 0.1.6: the car's raw gearbox values, the first 12 distinct ones (no G01 log of manual mode or the gears exists yet)
            const gearSeen = Object.create(null);
            let gearCount = 0;
            const gearboxLog = (x) => {
                let k = '';
                try { k = JSON.stringify(x); } catch (e) { k = String(x); }
                k = String(k).slice(0, 200);
                if (gearCount >= 12 || gearSeen[k]) return;
                gearSeen[k] = true; gearCount++;
                log.info('gearbox: ' + k); diag('gearbox: ' + k);
            };
            const signals = ctx.signals && Object.assign({}, ctx.signals, {
                watch(iface, inst, handlers, lg, opts) {
                    const h = {};
                    Object.keys(handlers || {}).forEach((f) => { const fn = handlers[f]; h[f] = (x) => { seen[iface] = true; return fn(x); }; });
                    let poll = null, own = null;
                    if (iface === V2 && h.statusCarSpeed2) { const f0 = h.statusCarSpeed2; own = (x) => { if (speedIn(x) !== false) f0(x); }; poll = speedPoll; h.statusCarSpeed2 = poll.wrap(own); }
                    if (iface === CDS && h.statusEngineSpeed2) { own = h.statusEngineSpeed2; poll = rpmPoll; h.statusEngineSpeed2 = poll.wrap(own); }
                    if (iface === VI && h.statusGearboxDrive) { const f0 = h.statusGearboxDrive; h.statusGearboxDrive = (x) => { gearboxLog(x); return f0(x); }; }
                    (hooks.handlers[iface] = hooks.handlers[iface] || []).push(h);
                    const p = Promise.resolve(ctx.signals.watch(iface, inst, h, lg, opts));
                    watched.push(p);
                    p.then(guard('watch ' + iface, (res) => { watchRes[iface] = res; if (poll) poll.attach(res, own); }), () => {});
                    return p;
                },
            });

            const walk = (o, fn) => {
                if (!o || typeof o !== 'object') return;
                if (Array.isArray(o)) { o.forEach((x) => walk(x, fn)); return; }
                fn(o);
                Object.keys(o).forEach((k) => { if (o[k] && typeof o[k] === 'object') walk(o[k], fn); });
            };
            const tyreP = (raw) => {
                const x = sc('tyrePress', raw);
                if (x === null) return null;
                const k = { BAR: 1, KPA: 0.01, PSI: 1 / 14.5038 }[carUnits.press];
                if (k) return x * k;
                if (x >= 0.8 && x <= 6) return x;
                if (x >= 7 && x < 60) return x / 14.5038;
                return x >= 60 && x <= 600 ? x / 100 : null;
            };
            const tyreT = (raw) => { const x = sc('tyreTemp', raw); return x !== null && carUnits.temp === 'F' ? (x - 32) * 5 / 9 : x; };
            const extra = {
                [FES]: {
                    statusFESVehicleDynamicSwitchHMI: guard('drive mode', (x) => {
                        const raw = x && x.actualValueModeDrivingExperience, m = L.driveModeOf(raw);
                        modeRaw = typeof raw === 'number' || typeof raw === 'string' ? String(raw).replace(/[^\x20-\x7e]/g, '?').slice(0, 20) : '?';
                        if (m === carMode) return;
                        carMode = m;
                        log.info('car drive mode ' + JSON.stringify(raw) + ' -> ' + (m || 'none'));
                        coverTick(); changed();
                    }),
                    statusSwitchDriveDynamicSport2: guard('boost', (x) => { vals.boost = sc('boost', x && x.displayBoostPressure); }),
                },
                [TPMS]: {
                    statusTyrePressure: guard('tyre pressure', (x) => { vals.tyres.p = ['FLH', 'FRH', 'RLH', 'RRH'].map((w) => tyreP(x && x['actualValuePressureTyre' + w])); }),
                    statusTyreTemperature: guard('tyre temperature', (x) => { vals.tyres.t = ['FLH', 'FRH', 'RLH', 'RRH'].map((w) => tyreT(x && x['actualValueTemperatureTyre' + w])); }),
                },
                [KOMBI]: {
                    statusRangeTankStatus: guard('tank', (x) => {
                        const f = x && x.fluidLevelFuelTank, r = x && x.range;
                        vals.fuelL = isNum(f) && f >= 0 && f < 255 ? f : null;
                        vals.rangeKm = isNum(r) && r >= 0 && r < 4095 ? r : null;
                    }),
                    statusBordcomputerTravelData: guard('trip', (x) => {
                        const w = x && x.wayPassed, h = x && x.rideDurationHours, m = x && x.rideDurationMinutes;
                        vals.trip.km = isNum(w) && w < 65535 ? w : null;
                        vals.trip.h = isNum(h) && h < 65535 && isNum(m) && m < 60 ? h : null;
                        vals.trip.m = vals.trip.h === null ? null : m;
                    }),
                    statusBordcomputerAverage: guard('trip average', (x) => {
                        const c = x && x.consumptionAverage1BC1, s = x && x.speedAverage1BC1;
                        const cf = CONS_L100[x && x.statusUnitOfMeasurementConsumptionBC], sf = SPEED_KMH[x && x.statusUnitOfMeasurementSpeedBC];
                        vals.trip.avgL100 = isNum(c) && c > 0 && c < 65535 && cf ? cf(c * 0.1) : null;
                        vals.trip.avgKmh = isNum(s) && s < 65535 && sf ? s * 0.1 * sf : null;
                    }),
                },
                [ENV]: { ExteriorTemperature: guard('outside temperature', (x) => { vals.ambient = sc('ambient', x && x.temperatureExterior); }) },
                [VEH]: {
                    statusNewCurrentUnitsStatusExt: guard('car units', (x) => {
                        const p = PRESS_UNITS[x && x.unitOfMeasurementAirPressure] || null, t = TEMP_UNITS[x && x.unitOfMeasurementTemperature] || null;
                        if (p === carUnits.press && t === carUnits.temp) return;
                        carUnits.press = p; carUnits.temp = t;
                        log.info('car units: pressure ' + (p || '?') + ', temperature ' + (t || '?'));
                        rearm(); changed();
                    }),
                },
                [CCM]: {
                    basicList: guard('check control', (x) => {
                        walk(x, (o) => {
                            if (o.ccmId === undefined) return;
                            if (o.activeState === 'AKTIV' || o.activeState === 0) cc.active.add(o.ccmId); else cc.active.delete(o.ccmId);
                        });
                        coverTick();
                    }),
                },
                [KI2]: { newCCMessage: guard('new check control', () => { cc.newAt = Date.now(); coverTick(); }) },
            };
            const car = new Car(Object.assign({}, ctx, { signals }), ['rpm', 'temps', 'speed', 'gear', 'accel', 'torque'], extra);

            /* ---------- the cover ---------- */
            /** Shown, or a build under way (its layers made or about to be): a failing guard drops it. */
            const active = (st) => st.shown || ['waiting', 'handover', 'confirming', 'writing'].indexOf(st.build.state) >= 0;
            let since = null, dec = { want: false, reason: 'off' }, slat = null, lastStats = Date.now();
            let sigKey = '', ccWas = '', heldUntil = null, busyWas = '';
            // 0.1.6: the rpm lead (sampleMs: Car's wall-clock time of the newest sample) and the rpm path's timings for the log
            let lead = L.makeLead(cfg.rpmLead), sampleMs = null;
            const perf = { sendMs: 0, boxMs: 0 };
            const msSince = (t0) => { const t = process.hrtime(t0); return t[0] * 1e3 + t[1] / 1e6; };
            const recentError = (now) => { const e = safety.lastErrorAt(); return isNum(e) && now - e >= 0 && now - e < cfg.safety.showHoldMs; };
            /** Parked enough for a test step: in P, or the last valid speed under cfg.test.parkedKmh. */
            const parked = () => d.stage === 'P' || (isNum(speedKmh) && speedKmh < cfg.test.parkedKmh);
            /** The newest release check: the watcher's after a close, or the cover connection's own after a drop. */
            const latestRelease = (st) => (release && (release.pending || !st.release || release.at >= st.release.at) ? release : st.release) || null;
            /** Every signal and guard state the Safety page shows (coarse: no counters, so it redraws only on a change). */
            function sigNow(now) {
                const st = output.status();
                return {
                    speed: L.speedStatus(speedAt, now, v.speedStaleMs, cfg), mode: carMode, modeRaw, fes: ifaceState(FES),
                    cc: ifaceState(CCM), ccUp: cc.active.size, ki2: ifaceState(KI2), rpm: ifaceState(CDS),
                    link: st.link, target: st.target, holder: st.holder, reason: st.reason, shown: st.shown, art: artOk,
                    killed, tripped: safety.tripped(), errorRecent: recentError(now), demo: !!d.demo,
                    hud: st.targets.hud ? st.targets.hud.state : null, rendering: st.rendering, cap: st.cap, lastError: st.lastError,
                    busy: st.busy, others: st.others, warm: st.warm, release: latestRelease(st), test: ladder ? ladder.status() : null, build: st.build,
                };
            }
            const model = () => ({ get, schema, cfg, carMode, reason: dec.reason, avail, version: (ctx.spec && ctx.spec.version) || '', sig: sigNow(Date.now()) });
            // why the cover is off, in the log: once a reason per 10 s (a backward clock jump logs again, KB-ANY-204)
            const whyAt = Object.create(null);
            function whyLog(reason, now) {
                if (reason === 'showing' || reason === 'hold') return;
                if (now >= whyAt[reason] && now - whyAt[reason] < 10000) return;
                whyAt[reason] = now;
                log.info('why off: ' + P.whyOf(model()).short);
            }
            function rearm() {
                const want = v.coverOn === true && !killed && !safety.tripped() && artOk;
                if (want) {
                    if (ladder && ladder.running()) ladder.stop('Cover the cluster turned on');
                    if (output.arm(units().temp === 'C' ? 'metric' : 'us')) drawBoxes(output, true);
                } else if (output.status().armed) {
                    const why = v.coverOn !== true ? 'cover off' : killed ? 'kill file' : safety.tripped() ? 'stopped after errors' : 'no art';
                    output.disarm(why);
                    since = null;
                    checkRelease(why);
                }
            }
            function frame() {
                const u = units(), th = L.thresholds(cfg, carMode || 'sportplus', d.oil);
                // the bar and the slats a moment ahead of the car's rpm (Tach lead); the KNOWN step's needle stays raw
                const ld = lead(d.rpm, isNum(sampleMs) ? sampleMs : Date.now(), v.tachLead);
                slat = L.step(slat, ld.rpm, th, cfg, ld.add);
                const kmh = isNum(speedKmh) ? speedKmh * cfg.speedFactor : null;
                return {
                    mph: kmh === null ? null : kmh / U.KM_PER_MI, rpm: isNum(d.rpm) ? d.rpm : null,   // the KNOWN step's needles
                    yr: G.yOfRpm(isNum(ld.rpm) ? ld.rpm : 0, cfg.tach),
                    quads: G.centreQuads(art.atlas, { gear: L.gearGlyph(d.stage, d.gear), speed: kmh === null ? null : U.SPD(kmh, u), unit: u.speed }),
                    slats: v.coverSlats ? slat : null,
                    level: L.levelOf(cfg, v),
                };
            }
            function liveVals() {
                const now = new Date();
                return Object.assign({}, vals, {
                    coolant: d.coolant, oil: d.oil, torque: d.torque, gLat: d.gLat, gLong: d.gLong, mode: carMode,
                    kw: isNum(d.torque) && isNum(d.rpm) ? Math.max(0, d.torque * d.rpm / 9549) : null,
                    clock: { h: now.getHours(), m: now.getMinutes() },
                });
            }
            const boxCv = {}, boxKey = {}, boxAt = {}, BOX_ORDER = ['panelL', 'panelR', 'cornerL', 'cornerR'];
            let cornerBase = null, boxNext = 0;
            /**
             * The four live boxes into out (the cover's output, or a test step's: always whole, never cached). one (the
             * cover loop's call, 0.1.6): at most one changed box this call, round robin, each box at most panelHz; a box
             * takes ~7 ms to draw under Node 8 (iDrive-Apps docs/emulator/mtrack-0.1.6/latency.md), so two in one tick would
             * hold an rpm sample back twice as long.
             */
            function drawBoxes(out, force, one) {
                if (!out.status().armed) return;
                const t0 = process.hrtime();
                drawBoxesNow(out, force, one && out === output && !force);
                perf.boxMs = Math.max(perf.boxMs, msSince(t0));
            }
            function drawBoxesNow(out, force, one) {
                const u = units(), lay = L.layoutOf(v), x = liveVals(), own = out === output;
                if (!cornerBase) cornerBase = { cornerL: null, cornerR_us: null, cornerR_metric: null };
                const baseOf = (n) => {
                    if (!cornerBase[n]) { const it = art.items.filter((i) => i.name === n)[0]; cornerBase[n] = require('zlib').inflateRawSync(Buffer.from(it.data, 'base64')); }
                    return cornerBase[n];
                };
                const now = Date.now(), gap = 1000 / cfg.panelHz;
                const put = (n, key, draw) => {
                    if (own && !force && boxKey[n] === key) return false;
                    if (one && now >= boxAt[n] && now - boxAt[n] < gap) return false;   // drawn too recently (a clock that went back: due)
                    if (own) { boxKey[n] = key; boxAt[n] = now; }
                    const r = G.RECTS[n], cv = boxCv[n] || (boxCv[n] = new Canvas(r.w, r.h));
                    draw(cv, r);
                    out.box(n, Buffer.from(cv.d.buffer, cv.d.byteOffset, cv.d.length));
                    return true;
                };
                const box = {
                    panelL: () => put('panelL', W.panelKey(lay.left, x, u, avail, cfg), (cv, r) => W.drawPanel(cv, r, -1, lay.left, x, u, avail, cfg)),
                    panelR: () => put('panelR', W.panelKey(lay.right, x, u, avail, cfg), (cv, r) => W.drawPanel(cv, r, 1, lay.right, x, u, avail, cfg)),
                    cornerL: () => put('cornerL', W.cornerKey(-1, x, u, cfg), (cv, r) => W.drawCorner(cv, r, -1, baseOf('cornerL'), x, u, cfg)),
                    cornerR: () => put('cornerR', W.cornerKey(1, x, u, cfg) + (u.temp === 'C' ? 'm' : 'u'), (cv, r) => W.drawCorner(cv, r, 1, baseOf(u.temp === 'C' ? 'cornerR_metric' : 'cornerR_us'), x, u, cfg)),
                };
                if (!one) { BOX_ORDER.forEach((n) => box[n]()); return; }
                for (let k = 0; k < BOX_ORDER.length; k++) {
                    const i = (boxNext + k) % BOX_ORDER.length;
                    if (box[BOX_ORDER[i]]()) { boxNext = (i + 1) % BOX_ORDER.length; return; }
                }
            }
            function coverTick() {
                const now = Date.now(), st = output.status(), ccs = ifaceState(CCM);
                const s = {
                    coverOn: v.coverOn, killed, tripped: safety.tripped(), demo: !!d.demo, art: artOk, link: st.link,
                    cc: ccs === 'present' || ccs === 'waiting' ? ccs : 'missing',
                    ccActive: cc.active.size > 0, ccNewAt: cc.newAt, target: st.target, holder: st.holder, speedAt,
                    lastErrorAt: safety.lastErrorAt(), mode: carMode, when: v.whenToShow,
                    popupGuard: v.popupGuard, modeMissingDrop: v.modeMissingDrop, staleMs: v.speedStaleMs,
                    busy: st.busy, heldUntil,
                };
                const r = L.decide(s, now, since, cfg);
                since = r.since;
                const before = dec.reason;
                dec = r;
                if (!r.want && active(st)) {
                    output.drop(r.reason);
                    if (r.reason === 'held') { heldUntil = now + cfg.renderer.heldBackoffMs; log.info('cover: BMW took the panel (' + (st.reason || st.holder || st.target) + '): asking again in ' + cfg.renderer.heldBackoffMs / 1000 + ' s'); }
                } else if (r.want && !st.shown) output.show(frame());      // builds stage by stage; logs "cover: shown" when done
                else if (r.want) output.update(frame());
                output.tick(Date.now());   // after show() stamped its start: an older `now` would read as a clock jump
                if (st.busy !== busyWas) {
                    busyWas = st.busy;
                    if (st.busy) { log.warn('cover: another app is using the cluster (' + st.busy + '): the cover waits'); output.requestStatus('another app: ' + st.busy); }
                }
                const key = JSON.stringify(sigNow(now));
                if (r.reason !== before || key !== sigKey) { sigKey = key; changed(); }
                if (r.reason !== before) whyLog(r.reason, now);
                if (ccs !== ccWas) { ccWas = ccs; log.info('BMW popup signal (CheckControlMaster): ' + ccs); }
            }
            const tick = guard('cover', () => {
                const k = safety.pollKill(fs, killPath);
                if (k !== killed) {
                    killed = k;
                    log.warn(k ? 'kill file found: cover off' : 'kill file gone: cover allowed');
                    if (k && ladder) ladder.stop('kill file');
                    rearm(); changed();
                }
                coverTick();
                const now = Date.now();
                if (ladder) ladder.tick(now, { parked: parked() });
                drawBoxes(output, false, true);       // at most one changed box a tick, each at most panelHz
                if (now < lastStats || now - lastStats >= cfg.statsLogMs) {
                    const sp = speedPoll.stats();
                    log.info('speed alive ' + (isNum(speedAt) ? (now - speedAt) + ' ms ago' : 'never') + ', notified/s ' + sp.notified.toFixed(1) + ', speed poll ' + sp.polled.toFixed(1) + '/s, poll failures ' + sp.fails + ', cover ' + dec.reason + ', popups ' + ifaceState(CCM) + ', drive mode ' + (carMode || 'missing'));
                    const rp = rpmPoll.stats(), w = output.wireStats(), f1 = (x) => (x === null ? '-' : x.toFixed(x < 10 ? 1 : 0));
                    log.info('rpm notified/s ' + rp.notified.toFixed(1) + ' (gap p50/p90 ' + f1(rp.gapP50) + '/' + f1(rp.gapP90) + ' ms), rpm poll ' + rp.polled.toFixed(1) +
                        '/s (rtt p50 ' + f1(rp.rttP50) + ' ms, fails ' + rp.fails + '), sample->send max ' + f1(perf.sendMs) + ' ms, box draw max ' + f1(perf.boxMs) +
                        ' ms, socket blocked ' + w.blocked + ' of ' + w.ticks + ' pump ticks, tach lead ' + v.tachLead + ' ms');
                    perf.sendMs = 0; perf.boxMs = 0;
                    lastStats = now;
                }
            });
            safety.onError(() => { if (active(output.status())) output.drop('error'); since = null; });
            safety.onTrip(() => {
                if (ladder) ladder.stop('stopped after errors');
                if (output.disarm('stopped after errors')) checkRelease('stopped after errors');
                since = null; changed();
            });

            /* ---------- samples ---------- */
            const OFF_PEAK = { right: 0, brake: 0, left: 0, accel: 0 };
            car.onSample(guard('sample', (data, t) => {
                const t0 = process.hrtime();
                d = data; sampleMs = isNum(t) ? t : null;
                if (!d.demo) {
                    if (isNum(d.gLat)) { vals.peaks.right = Math.max(vals.peaks.right, d.gLat); vals.peaks.left = Math.max(vals.peaks.left, -d.gLat); }
                    if (isNum(d.gLong)) { vals.peaks.accel = Math.max(vals.peaks.accel, d.gLong); vals.peaks.brake = Math.max(vals.peaks.brake, -d.gLong); }
                    if (isNum(speedKmh)) vals.timer = L.timerStep(vals.timer, speedKmh, Date.now(), units().speed === 'mph' ? 60 * U.KM_PER_MI : 100);
                }
                // the revs and the slats follow each sample at once (Shift Lights' latency lesson), the rest the tick
                if (dec.want && output.status().shown) output.update(frame());
                perf.sendMs = Math.max(perf.sendMs, msSince(t0));
            }), guard('source', () => { slat = null; lead = L.makeLead(cfg.rpmLead); sampleMs = null; vals.peaks = Object.assign({}, OFF_PEAK); coverTick(); changed(); }));

            /* ---------- settings pages ---------- */
            const pages = createUi();
            let drawQueued = false;
            const draw = guard('draw', () => {
                drawQueued = false;
                if (!ui.isVisible('MAIN')) return undefined;
                const t = ctx.theme(), cv = ctx.canvas(1600, 520).clear(t.bg);
                pages.draw(cv, t, model(), act);
                return ui.image('MAIN_GFX', cv);
            });
            function changed() { if (!drawQueued) { drawQueued = true; setTimeout(draw, 0); } }
            /** A page control: its settings writes, or an action (the test pattern's steps and STOP). */
            const act = (writes, action) => guard('ui ' + (action || writes.map((w) => w[0]).join(' ')), () => {
                if (action) doAction(action);
                writes.forEach((w) => settings.set(w[0], w[1]));
            });
            let card = null;
            const knownCard = () => card || (card = ST.knownCard(Canvas, (ctx.spec && ctx.spec.version) || ''));
            ladder = createLadder({
                cfg, log, diag, verify, changed, frame: () => frame(), drawBoxes: (out) => drawBoxes(out, true), art: art || {}, knownCard,
                units: () => (units().temp === 'C' ? 'metric' : 'us'),
                makeOutput: (opts) => createOutput(Object.assign({ ClusterRender, socketPath: crSocket, log, cfg, guard, art: art || {}, diag, fault: (msg) => log.warn('test: ' + msg) }, opts)),
            });
            function doAction(a) {
                const m = /^test:([1-6]|stop)$/.exec(a);
                if (!m) return;
                if (m[1] === 'stop') ladder.stop('stop button');
                else if (!artOk && Number(m[1]) >= 5) log.warn('test: step ' + m[1] + ' needs the art file');
                else ladder.start(Number(m[1]), { armed: output.status().armed, parked: parked() });
                changed();
            }
            hooks.action = doAction;           // emulator only (emufeed.js)

            let wasOn = v.coverOn === true;
            settings.onChange(guard('settings', (key, value) => {
                const before = v;
                v = read();
                if (key === 'coverOn') {
                    if (value === true && !wasOn && safety.tripped()) { safety.reset(); log.info('safety reset by Cover the cluster'); }
                    wasOn = value === true;
                }
                rearm();                                   // cover off: disarmed here, not on the next tick
                if (key === 'coverSlats' && before.coverSlats !== v.coverSlats && output.status().shown) { output.drop('slats setting'); output.show(frame()); }
                drawBoxes(output, false);
                coverTick();
                changed();
            }));
            ui.onClick('BTN_COVER', guard('cover on/off', () => settings.cycle('coverOn')));
            if (ctx.hideButton) ['BTN_COVER', 'BTN_ALL'].forEach((b) => ctx.hideButton(b));
            ui.onClick('BTN_ALL', guard('settings button', () => ui.open && ui.open('SETTINGS')));
            ui.onVisible(guard('visible', (name, on) => { if (name === 'MAIN' && on) changed(); }));
            if (ctx.onTab) ctx.onTab(guard('tab', (i) => { pages.tab(i); changed(); }));
            if (ctx.onLayout) ctx.onLayout(guard('layout', changed));
            if (ui.onFocus) ui.onFocus(guard('focus', (name, on) => { if (name === 'MAIN' && on) changed(); }));

            // exit: drop and close at once (best effort; a crash closes the socket and the service drops the layers)
            process.on('exit', () => {
                try { if (ladder) ladder.stop('exit', true); } catch (e) { /* exiting */ }
                try { output.disarm('exit'); } catch (e) { /* exiting */ }
            });
            if (process.env.MTRACK_EMU_FEED) require('./emufeed').start(process.env.MTRACK_EMU_FEED, hooks, log, guard);

            Promise.all(watched).then(guard('polls start', () => {
                speedPoll.start(); rpmPoll.start();
                log.info('signals after the watches: ' + P.sigSummary(model()));
            }), (e) => log.warn('polls not started: ' + e));
            setInterval(tick, cfg.safety.tickMs);
            // the dead-man re-arm (output.pump: a new animation every aliveRearmMs while something of ours is shown)
            setInterval(guard('alive', () => { const now = Date.now(); output.pump(now); if (ladder) ladder.pump(now); }), cfg.safety.alivePumpMs);
            rearm();
            changed();
            log.info('started: cover ' + (v.coverOn ? 'on' : 'off') + ', when ' + v.whenToShow + ', BMW popups ' + v.popupGuard + ', drop if no drive mode ' + v.modeMissingDrop +
                ', speed timeout ' + v.speedStaleMs + ' ms, units ' + v.units + ', panels ' + JSON.stringify(L.layoutOf(v)));
        } catch (e) {
            log.error('start: ' + (e && e.stack || e));
        }
    },
});
