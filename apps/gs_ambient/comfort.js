'use strict';
/**
 * comfort.js - the decision Iterio's comfort service uses for the ambient light, and the files the
 * keeper shares with the screen. The colour is sent only while BDC-Licht is chosen, the car's own
 * ambient light is on, and someone is still in the car. Parked or standby (the car locked and left)
 * hands the modules back and the keeper process exits, so it does not keep the head unit awake.
 * A condition that has not been heard yet does not block the colour.
 */
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const REV = 4;

const IN_CAR = [5, 7, 8, 10, 12];
const KNOWN = [1, 2, 3, 5, 7, 8, 10, 12];
const CONDITIONS = {
    PARKEN_BN_NIO: 1, PARKEN_BN_IO: 2, STANDFUNKTIONEN_KUNDE_NICHT_IM_FZG: 3, WOHNEN: 5,
    PRUEFEN_ANALYSE_DIAGNOSE: 7, FAHRBEREITSCHAFT_HERSTELLEN: 8, FAHREN: 10, FAHRBEREITSCHAFT_BEENDEN: 12,
};

function paths(dir) {
    return {
        state: path.join(dir, 'gs_ambient_state.json'),
        light: path.join(dir, 'gs_ambient_light.json'),
        status: path.join(dir, 'gs_ambient_comfort.json'),
        pid: path.join(dir, 'gs_ambient_comfort.pid'),
        log: path.join(dir, 'gs_ambient_comfort.log'),
        debug: path.join(dir, 'gs_ambient_debug.log'),
        probe: path.join(dir, 'gs_ambient_probe.json'),
        cond: path.join(dir, 'gs_ambient_cond.json'),
        stamp: path.join(dir, 'gs_ambient_comfort.rev'),
    };
}

function readJson(file) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
}

function writeJson(file, obj) {
    try { fs.mkdirSync(path.dirname(file)); } catch (e) { /* the app data dir is already there */ }
    fs.writeFileSync(file + '.tmp', JSON.stringify(obj));
    fs.renameSync(file + '.tmp', file);
}

function alive(pidFile) {
    try { process.kill(Number(fs.readFileSync(pidFile, 'utf8')), 0); return true; } catch (e) { return false; }
}

/** A VehicleCondition value -> its number, or null when this process cannot read it. */
function codeOf(v) {
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(v)) v = Array.prototype.slice.call(v);
    if (typeof v === 'number' && isFinite(v)) return v;
    if (Array.isArray(v)) return v.length > 5 && KNOWN.indexOf(v[5]) >= 0 ? v[5] : null;
    if (typeof v === 'string') {
        if (String(parseInt(v, 10)) === v) return parseInt(v, 10);
        const s = v.toUpperCase();
        if (CONDITIONS[s]) return CONDITIONS[s];
        if (s.indexOf('STAND') >= 0 || s.indexOf('PARK') >= 0) return 1;
        if (s.indexOf('WOHN') >= 0 || s.indexOf('RESID') >= 0) return 5;
        if (s.indexOf('PRUEF') >= 0 || s.indexOf('PRÜF') >= 0 || s === 'TEST') return 7;
        if (s.indexOf('FAHRBEREIT') >= 0 || s.indexOf('READY') >= 0) return 8;
        if (s.indexOf('FAHR') >= 0 || s.indexOf('DRIV') >= 0) return 10;
        return null;
    }
    if (v && typeof v === 'object') {
        const keys = ['conditionVehicle', 'statusConditionVehicle', 'value', 'state', 'VehicleCondition'];
        for (let i = 0; i < keys.length; i++) {
            if (v[keys[i]] !== undefined && v[keys[i]] !== v) {
                const n = codeOf(v[keys[i]]);
                if (n !== null) return n;
            }
        }
    }
    return null;
}

/** true once the car has said it is parked or locked with nobody in it. Unknown is not that. */
function leftCar(cond) {
    const n = codeOf(cond);
    return n !== null && IN_CAR.indexOf(n) < 0;
}

/** true: someone is in the car, or the car has not said yet. false: parked or standby. */
function inCar(cond) {
    if (cond === undefined || cond === null) return true;
    const n = codeOf(cond);
    if (n === null) return true;
    return IN_CAR.indexOf(n) >= 0;
}

/** true when the factory ambient light allows our colour. Unknown (the car never answered) allows it. */
function ambientAllows(on, known) {
    if (!known) return true;
    return on === true;
}

function shouldLight(g) {
    return !!(g && g.backend === 'bdc' && inCar(g.cond) && ambientAllows(g.ambientOn, g.ambientKnown));
}

/**
 * Whether the screen process should start the keeper.
 * boot: the head unit just started this process. opened: a screen is on show.
 * woke: the car was left and someone is in it again. parked: that leave was seen.
 */
function shouldEnsure(o) {
    if (!o || o.light !== 'bdc') return false;
    if (o.left) return false;
    if (o.opened) return true;
    if (!o.autostart) return false;
    if (o.woke) return true;
    return !!(o.boot && !o.parked);
}

function whyNot(g) {
    if (!g || g.backend !== 'bdc') return null;
    if (!inCar(g.cond)) return 'Auto aus';
    if (g.ambientKnown && g.ambientOn !== true) return 'Ambiente aus';
    return null;
}

/** The screen's stand-in for BDC-Licht: it draws, and the keeper does the writing. release() does not touch the car. */
function createMirror(statusFile) {
    return {
        name: 'bdc', label: 'BDC-Licht', kind: 'real', validated: true, maxRate: 20,
        capabilities: { freeColor: true, brightness: true },
        apply: function () { return Promise.resolve({ ok: true }); },
        release: function () { return Promise.resolve(); },
        liveStatus: function () {
            const s = readJson(statusFile);
            if (s && s.state && s.state !== 'bereit') return { state: s.state, reason: s.reason || null };
            return { state: 'aus', reason: 'Dienst nicht gestartet' };
        },
    };
}

/** Interface names in the head unit's SOME/IP catalog that tell us what this car actually calls the light and the vehicle condition. */
function catalogNames(text) {
    const re = /de\.bmw\.[A-Za-z0-9_.]+/g;
    const keep = /ambien|interior|innenlicht|lci|vehiclecondition|comfort/i;
    const out = [], seen = {};
    let m;
    while ((m = re.exec(text || ''))) {
        if (!keep.test(m[0]) || seen[m[0]]) continue;
        seen[m[0]] = true;
        out.push(m[0]);
        if (out.length >= 80) break;
    }
    return out;
}

/** One debug line, and the latest picture in the probe file. Off until the setting is on: the caller decides. */
function record(files, report) {
    const row = JSON.parse(JSON.stringify(report));
    row.updated = new Date().toISOString();
    try {
        const file = files.debug, cap = 512 * 1024;
        const st = fs.existsSync(file) ? fs.statSync(file) : null;
        if (st && st.size > cap) fs.renameSync(file, file + '.1');
        fs.appendFileSync(file, JSON.stringify(row) + '\n');
    } catch (e) { /* the data dir can be briefly missing */ }
    try { writeJson(files.probe, row); } catch (e) { /* same */ }
    return row;
}
/** 0 keeps today's hand-back after a short settle. Any chosen offset is 10–120 s, then the modules go dark. */
function nachlaufMs(v) {
    const n = Number(v);
    if (!isFinite(n) || n <= 0) return 5000;
    return Math.max(10, Math.min(120, Math.round(n))) * 1000;
}

function keeperCurrent(stamp) {
    return !!(stamp && stamp.rev === REV);
}

function retire(pidFile) {
    let pid;
    try { pid = Number(fs.readFileSync(pidFile, 'utf8')); } catch (e) { return; }
    if (!pid) return;
    try { process.kill(pid, 'SIGTERM'); } catch (e) { return; }
    const until = Date.now() + 3000;
    while (Date.now() < until) {
        try { process.kill(pid, 0); } catch (e) { return; }
        spawnSync('sleep', ['0.2']);
    }
}

function ensure(dataDir, log) {
    const p = paths(dataDir);
    if (alive(p.pid)) {
        if (keeperCurrent(readJson(p.stamp))) return;
        retire(p.pid);
        if (alive(p.pid)) { if (log) log.info('comfort keeper wechselt noch'); return; }
    }
    writeJson(p.stamp, { rev: REV });
    const child = spawn(process.execPath, [path.join(__dirname, 'comfort_keep.js'), dataDir], { detached: true, stdio: 'ignore' });
    child.unref();
    if (log) log.info('comfort keeper ' + child.pid);
}

module.exports = {
    IN_CAR: IN_CAR, paths: paths, readJson: readJson, writeJson: writeJson, alive: alive,
    REV: REV, keeperCurrent: keeperCurrent, nachlaufMs: nachlaufMs,
    codeOf: codeOf, inCar: inCar, leftCar: leftCar, ambientAllows: ambientAllows, shouldLight: shouldLight, shouldEnsure: shouldEnsure, whyNot: whyNot,
    createMirror: createMirror, ensure: ensure, catalogNames: catalogNames, record: record,
};
