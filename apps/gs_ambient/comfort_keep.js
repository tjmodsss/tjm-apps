'use strict';
/**
 * comfort_keep.js - the process that keeps the colour on after the screen is gone.
 * With the debug setting on it also writes gs_ambient_probe.json: the names this car uses,
 * what the body controller answered, and whether the colour was allowed to stay on.
 *   node comfort_keep.js <data-dir>
 */
const fs = require('fs');
const comfort = require('./comfort');
const { readState } = require('./state');
const fx = require('./fx');
const light = require('./light');
const signals = require('./kit/signals');

const CATALOG = '/etc/oap/someip/someip-interfaces.json';
const dir = process.argv[2];
if (!dir) { console.error('usage: node comfort_keep.js <data-dir>'); process.exit(2); }
const p = comfort.paths(dir);

function logLine(m) {
    try { fs.appendFileSync(p.log, new Date().toISOString() + ' ' + m + '\n'); } catch (e) { /* the dir may be briefly missing */ }
}
const log = { info: function (m) { logLine(m); }, warn: function (m) { logLine('warn ' + m); } };

if (comfort.alive(p.pid)) process.exit(0);
try { fs.writeFileSync(p.pid, String(process.pid)); } catch (e) { log.warn('pid: ' + e.message); }

const car = { cond: null, ambientOn: null, ambientKnown: false, vehicleRaw: null, ambientRaw: null, vehicleError: null, ambientError: null };
const report = { debug: false, catalog: null, vehicle: null, ambient: null, bdc: null, gate: null, light: null };
let backend = null, sender = null, loop = null, stopping = false, shown = '';
let debugOn = false, surveying = false, surveyAt = 0;
let vehicleSub = null, vehicleSeen = false, downSince = 0, leftSince = 0;

function getState() { return readState(p.state); }

function prefs() { return comfort.readJson(p.light) || {}; }

function gate() {
    return { backend: prefs().light || 'sim', cond: car.cond, ambientOn: car.ambientOn, ambientKnown: car.ambientKnown };
}

function publish(obj) {
    const s = JSON.stringify(obj);
    if (s === shown) return;
    shown = s;
    try { comfort.writeJson(p.status, obj); } catch (e) { log.warn('status: ' + e.message); }
}

function snap() {
    if (!debugOn) return;
    report.debug = true;
    report.vehicle = { error: car.vehicleError, last: car.vehicleRaw, code: comfort.codeOf(car.cond), inCar: comfort.inCar(car.cond) };
    report.ambient = { error: car.ambientError, last: car.ambientRaw, known: car.ambientKnown, on: car.ambientOn };
    report.gate = gate();
    report.gate.why = comfort.whyNot(report.gate);
    comfort.record(p, report);
}

function bdc() {
    if (!backend) backend = light.createBackend('bdc', { signals: signals, log: log });
    return backend;
}

function stopWriting() {
    const s = sender;
    sender = null;
    if (loop) { loop.stop(); loop = null; }
    return s ? s.release() : Promise.resolve();
}

function scanCatalog() {
    let text = null, error = null;
    try { text = fs.readFileSync(CATALOG, 'utf8'); } catch (e) { error = String(e.message || e); }
    report.catalog = error ? { error: error } : comfort.catalogNames(text);
    log.info('Katalog ' + (error || (report.catalog.length + ' Namen')));
}

function maybeSurvey() {
    if (!debugOn || surveying) return;
    if (report.bdc && report.bdc.ok && Date.now() - surveyAt < 300000) return;
    if (surveyAt && Date.now() - surveyAt < 20000) return;
    surveying = true;
    surveyAt = Date.now();
    bdc().survey().then(function (r) {
        surveying = false;
        report.bdc = r;
        log.info('Probe ' + JSON.stringify({ ok: r.ok, sgbd: r.sgbd, reason: r.reason || null, modules: r.modules ? r.modules.length : 0 }));
        snap();
    }).catch(function (e) { surveying = false; log.warn('Probe ' + e.message); });
}

function applyCond(v) {
    if (v === undefined || v === null) return;
    car.vehicleRaw = typeof v === 'string' ? v : JSON.stringify(v);
    car.vehicleError = null;
    const n = comfort.codeOf(v);
    if (n !== null) car.cond = n;
    log.info('Fahrzeug ' + car.vehicleRaw + (n === null ? ' (ungelesen)' : ' -> ' + n));
    snap();
}

function watchCar() {
    signals.watch('de.bmw.infrastructure.VehicleCondition', '1', {
        VehicleCondition: applyCond,
    }, log).then(function (sub) {
        vehicleSub = sub;
        if (sub.error) { car.vehicleError = sub.error; log.info('Fahrzeugzustand nicht da: ' + sub.error); snap(); return; }
        log.info('Fahrzeugzustand abonniert' + (sub.available ? ', Dienst da' : ', warte auf den Dienst'));
        if (!sub.proxy) return;
        signals.readField(sub.proxy, 'VehicleCondition', 3000).then(applyCond).catch(function (e) {
            log.info('Fahrzeugzustand ohne Abruf: ' + (e && e.message ? e.message : e));
        });
    });
    signals.watch('de.bmw.infotainment.misc.ComfortFunctionIuK', '1', {
        statusAmbientLightInteriorColour: function (v) {
            car.ambientRaw = typeof v === 'string' ? v : JSON.stringify(v);
            car.ambientError = null;
            log.info('Ambiente ' + car.ambientRaw);
            snap();
        },
    }, log).then(function (sub) { if (sub.error) { car.ambientError = sub.error; log.info('Menüfarbe nicht da: ' + sub.error); snap(); } });
}

function armLeave(why, at) {
    if (leftSince) return;
    leftSince = at;
    log.info(why + ', Nachlauf ' + Math.round(comfort.nachlaufMs(prefs().nachlauf) / 1000) + 's');
}

function tick() {
    if (stopping) return;
    if (vehicleSub && vehicleSub.available) { vehicleSeen = true; downSince = 0; }
    else if (vehicleSeen && !downSince) downSince = Date.now();
    const heard = comfort.readJson(p.cond);
    if (heard && typeof heard.code === 'number') car.cond = heard.code;
    const wait = comfort.nachlaufMs(prefs().nachlauf);
    const serviceDown = !!(vehicleSeen && downSince && Date.now() - downSince > 5000);
    if (comfort.leftCar(car.cond)) armLeave('Auto zu (' + car.cond + ')', Date.now());
    else if (serviceDown) armLeave('Fahrzeugzustand weg', downSince);
    else leftSince = 0;
    if (leftSince && Date.now() - leftSince >= wait) { if (wait > 5000) goDark(); else shutdown(); return; }
    const was = debugOn;
    debugOn = prefs().debug === true || prefs().debug === 'on';
    if (debugOn && !was) { report.catalog = null; report.bdc = null; surveyAt = 0; }
    if (debugOn && !report.catalog) scanCatalog();
    if (debugOn) maybeSurvey();
    const g = gate();
    if (!leftSince && (!comfort.shouldLight(g) || !getState())) {
        const why = comfort.whyNot(g);
        if (sender) stopWriting();
        publish(why ? { state: 'aus', reason: why } : { state: 'bereit', reason: null });
        report.light = why ? { state: 'aus', reason: why } : { state: 'bereit', reason: null };
        if (debugOn) snap();
        return;
    }
    if (!sender) {
        sender = light.createSender(bdc(), { log: log });
        loop = fx.createLoop({ getState: getState, readInputs: function () { return {}; }, sink: function (f) { if (sender) sender.push(f); } });
        loop.start();
        const resumed = getState();
        const grp = resumed && resumed.groups ? resumed.groups[resumed.group] : null;
        log.info('Licht an' + (resumed && resumed.effect ? ' ' + resumed.effect + (grp ? ' / ' + grp.name : '') : ''));
    }
    const st = sender.status();
    publish({ state: st.state, reason: st.reason || null });
    report.light = { state: st.state, reason: st.reason || null };
    if (debugOn) snap();
}

function finish(dark) {
    if (stopping) return;
    stopping = true;
    log.info(dark ? 'Nachlauf zu, Licht aus' : 'Ende, Farbe zurück');
    const s = sender;
    sender = null;
    if (loop) { loop.stop(); loop = null; }
    const job = s && dark && typeof s.extinguish === 'function' ? s.extinguish() : (s ? s.release() : null);
    Promise.resolve(job).then(function () { process.exit(0); });
    setTimeout(function () { process.exit(0); }, 8000);
}

function linger(ms) {
    if (stopping) return;
    stopping = true;
    const sec = Math.max(1, Math.round(ms / 1000));
    log.info('Headunit geht, Farbe noch ' + sec + 's');
    const s = sender;
    sender = null;
    if (loop) { loop.stop(); loop = null; }
    const job = s && typeof s.hold === 'function' ? s.hold(sec) : null;
    Promise.resolve(job).then(function () { process.exit(0); });
    setTimeout(function () { process.exit(0); }, 8000);
}

function shutdown() { finish(false); }
function goDark() { finish(true); }

function onSignal() {
    const wait = comfort.nachlaufMs(prefs().nachlauf);
    if (!(wait > 5000)) { shutdown(); return; }
    const left = leftSince ? wait - (Date.now() - leftSince) : wait;
    if (left > 1000) linger(left);
    else goDark();
}

watchCar();
setInterval(tick, 250);
process.on('SIGTERM', onSignal);
process.on('SIGINT', onSignal);
log.info('comfort keeper läuft');
