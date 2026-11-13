'use strict';
/**
 * light_bdc.js - free colour through the body controller, the way the confirmed actuator works.
 * Each write holds for 254 s and is sent again every 2 minutes. Switching the backend off, or
 * leaving the app, hands every module back at once. Sends only after the BDC answers as BDC_G05
 * (SGBD index 0F2680) and lists its light modules. The setting stays on "Simuliert" until chosen.
 */
const { Diag } = require('./kit/diag');
const P = require('./bdc_proto');

const ours = (sid, data) => (u) => u && ((u[0] === sid + 0x40 && u[1] === data[0] && u[2] === data[1]) || (u[0] === 0x7F && u[1] === sid));

function create(ctx) {
    const log = (ctx && ctx.log) || { info: function () {}, warn: function () {} };
    let diag = null, opening = null, sgbd = null, mods = null, f150 = null;
    let desired = null, stopped = false, timer = null, tail = Promise.resolve();
    const sent = {};
    const hex = (u) => (u || []).map(function (n) { return (n & 255).toString(16).toUpperCase().padStart(2, '0'); }).join('');

    function enqueue(job) {
        const run = tail.then(job, job);
        tail = run.then(function () {}, function () {});
        return run;
    }

    function link() {
        if (diag) return Promise.resolve(diag);
        if (!ctx || !ctx.signals) return Promise.resolve(null);
        if (opening) return opening;
        const d = new Diag(ctx.signals, log);
        d.quiet = true;
        opening = d.init().then(function () { diag = d.p ? d : null; opening = null; return diag; });
        return opening;
    }

    function read(d, sid, data) {
        return d.physical(P.BDC, sid, data, 4000, ours(sid, data)).then(function (u) {
            if (!u) throw new Error('keine Antwort');
            if (u[0] === 0x7F) throw new Error('BDC lehnt ab (' + (u[2] || 0).toString(16) + ')');
            return u;
        });
    }

    function identify(d) {
        if (sgbd) return Promise.resolve(sgbd);
        return read(d, 0x22, [0xF1, 0x50]).then(function (u) {
            sgbd = P.sgbdOf(u);
            f150 = hex(u);
            log.info('BDC ' + (sgbd || 'unbekannt'));
            return sgbd;
        });
    }

    function discover(d) {
        if (mods) return Promise.resolve(mods);
        let found = [];
        const next = function (i) {
            if (i >= P.BUSES.length) { mods = found; log.info('Lichtmodule: ' + mods.length); return mods; }
            const b = P.BUSES[i];
            return read(d, 0x22, b.read).then(function (u) { found = found.concat(P.parseModules(u, b.name)); return next(i + 1); });
        };
        return next(0);
    }

    function writeAll(d, list) {
        const next = function (i) {
            if (stopped || i >= list.length) return null;
            const item = list[i], key = item.mod.bus + '.' + item.mod.nad, mark = item.bytes.join(',');
            if (sent[key] === mark) return next(i + 1);
            return read(d, 0x2E, item.bytes).then(function () { if (!stopped) sent[key] = mark; return next(i + 1); });
        };
        return next(0);
    }

    function brief(list) {
        return list.map(function (m) { return { bus: m.bus, nad: m.nad, loc: '0x' + (m.loc & 255).toString(16).toUpperCase(), name: m.name, zone: m.zone }; });
    }

    /** Read the identity, both light buses and the colour blocks. Writes nothing. One bus failing leaves the other. */
    function survey() {
        return enqueue(function () {
            return link().then(function (d) {
                if (!d) return { ok: false, reason: 'keine Verbindung' };
                return identify(d).then(function (id) {
                    const buses = {}, blocks = {};
                    let list = [];
                    const readBus = function (i) {
                        if (i >= P.BUSES.length) return null;
                        const b = P.BUSES[i];
                        return read(d, 0x22, b.read).then(function (u) {
                            const parsed = P.parseModules(u, b.name);
                            buses[b.name] = { ok: true, bytes: u.length, fitted: parsed.length };
                            list = list.concat(parsed);
                        }).catch(function (e) {
                            buses[b.name] = { ok: false, reason: String(e.message || e) };
                        }).then(function () { return readBus(i + 1); });
                    };
                    const extra = [[0x36, 0x0A, '360A'], [0x36, 0x0D, '360D'], [0xF1, 0x90, 'F190']];
                    const readBlock = function (i) {
                        if (i >= extra.length) return null;
                        const item = extra[i];
                        return read(d, 0x22, [item[0], item[1]]).then(function (u) {
                            blocks[item[2]] = { ok: true, hex: hex(u) };
                        }).catch(function (e) {
                            blocks[item[2]] = { ok: false, reason: String(e.message || e) };
                        }).then(function () { return readBlock(i + 1); });
                    };
                    return readBus(0).then(function () { return readBlock(0); }).then(function () {
                        const both = buses.lin1 && buses.lin1.ok && buses.lin2 && buses.lin2.ok;
                        if (both) mods = list;
                        const out = { ok: id === P.SGBD_G05 && both && list.length > 0, sgbd: id, f150: f150, buses: buses, modules: brief(list), blocks: blocks };
                        log.info('Probe ' + (out.sgbd || 'ohne Index') + ', Module ' + list.length);
                        return out;
                    });
                });
            }).catch(function (e) { return { ok: false, reason: String(e.message || e) }; });
        });
    }

    function round(force) {
        return enqueue(function () {
            if (stopped) return { ok: false, reason: 'beendet' };
            return link().then(function (d) {
                if (!d) return { ok: false, reason: 'keine Verbindung' };
                return identify(d).then(function (id) {
                    if (id !== P.SGBD_G05) return { ok: false, reason: 'BDC ist nicht BDC_G05' };
                    return discover(d).then(function (list) {
                        if (!list.length) return { ok: false, reason: 'keine Lichtmodule' };
                        if (!desired) return { ok: true };
                        if (force) Object.keys(sent).forEach(function (k) { delete sent[k]; });
                        return writeAll(d, P.plan(list, desired)).then(function () {
                            if (!stopped && !timer) timer = setInterval(function () { round(true); }, P.RENEW_MS);
                            return { ok: true };
                        });
                    });
                });
            }).catch(function (e) { return { ok: false, reason: String(e.message || e) }; });
        });
    }

    return {
        name: 'bdc', label: 'BDC-Licht', kind: 'real', validated: true, maxRate: 2,
        capabilities: { freeColor: true, brightness: true },
        apply: function (frame) {
            stopped = false;
            desired = frame;
            return round(false);
        },
        survey: survey,
        release: function () {
            stopped = true;
            desired = null;
            if (timer) { clearInterval(timer); timer = null; }
            Object.keys(sent).forEach(function (k) { delete sent[k]; });
            return enqueue(function () {
                const d = diag, list = mods || [];
                if (!d || !list.length) return null;
                const next = function (i) {
                    return i >= list.length ? null : read(d, 0x2E, P.frameRelease(list[i])).catch(function () { return null; }).then(function () { return next(i + 1); });
                };
                return next(0);
            });
        },
        hold: function (frame, secs) {
            if (timer) { clearInterval(timer); timer = null; }
            desired = null;
            stopped = true;
            return enqueue(function () {
                const d = diag, list = mods || [];
                if (!d || !list.length || !frame) return null;
                const steps = P.plan(list, frame, secs);
                const next = function (i) {
                    return i >= steps.length ? null : read(d, 0x2E, steps[i].bytes).catch(function () { return null; }).then(function () { return next(i + 1); });
                };
                return next(0);
            });
        },
        extinguish: function () {
            stopped = true;
            desired = null;
            if (timer) { clearInterval(timer); timer = null; }
            Object.keys(sent).forEach(function (k) { delete sent[k]; });
            return enqueue(function () {
                const d = diag, list = mods || [];
                if (!d || !list.length) return null;
                const next = function (i) {
                    return i >= list.length ? null : read(d, 0x2E, P.frameOff(list[i])).catch(function () { return null; }).then(function () { return next(i + 1); });
                };
                return next(0);
            });
        },
    };
}

module.exports = { create };
