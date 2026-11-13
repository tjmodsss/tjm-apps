'use strict';
/**
 * light.js - the lighting backend for the "light" setting, and the sender in front of it: only changed
 * frames, at most maxRate a second (the newest wins), a failed one retried after 0.5, 1 and 2 s; the 4th
 * failure in a row stops it until the user does something (resume). A backend that is not validated on
 * the car is never called.
 */
const C = require('./color');

const KINDS = { sim: require('./light_sim'), profile: require('./light_profile'), bdc: require('./light_bdc') };
const BACKOFF = [500, 1000, 2000];
const MAX_FAILS = 4;
const LOCKED = { state: 'gesperrt', reason: 'noch nicht am Auto geprüft' };

function createBackend(kind, ctx) { return (KINDS[kind] || KINDS.sim).create(ctx); }

const same = (a, b) => !!a && !!b && a.brightness === b.brightness && String(a.upper) === String(b.upper) && String(a.lower) === String(b.lower);

function createSender(backend, opts) {
    const o = opts || {};
    const log = o.log || { info() {}, warn() {} };
    const clock = o.clock || { now: Date.now, setTimeout, clearTimeout };
    const gap = 1000 / backend.maxRate, okState = backend.kind === 'sim' ? 'simuliert' : 'aktiv';
    let pending = null, inflight = null, sent = null, lastAt = -Infinity, timer = null, fails = 0, stopped = false;
    let st = backend.validated ? { state: okState, reason: null } : LOCKED;
    const later = (ms) => { if (timer === null) timer = clock.setTimeout(() => { timer = null; flush(); }, ms); };
    function flush() {
        if (stopped || inflight || !pending || timer !== null) return;
        const wait = lastAt + gap - clock.now();
        if (wait > 0) { later(wait); return; }
        const frame = pending;
        inflight = frame; pending = null; lastAt = clock.now();
        Promise.resolve().then(() => backend.apply(C.toWire(frame, backend.capabilities)))
            .catch((e) => ({ ok: false, reason: String((e && e.message) || e) }))
            .then((r) => {
                inflight = null;
                if (stopped) return;
                if (r && r.ok) { fails = 0; sent = frame; st = { state: okState, reason: null }; flush(); return; }
                fails++;
                const why = (r && r.reason) || 'keine Antwort';
                if (!pending) pending = frame;
                log.warn('light ' + backend.name + ': ' + why + ' (' + fails + '. Fehlschlag in Folge)');
                if (fails >= MAX_FAILS) { stopped = true; st = { state: 'fehler', reason: why }; return; }
                later(BACKOFF[fails - 1]);
            });
    }
    return {
        push(frame) {
            if (!backend.validated) return;
            if (same(frame, pending || inflight || sent)) return;
            pending = frame;
            flush();
        },
        resume() {
            if (!backend.validated || st.state !== 'fehler') return;
            stopped = false; fails = 0; st = { state: okState, reason: null };
            flush();
        },
        status: () => {
            const live = typeof backend.liveStatus === 'function' ? backend.liveStatus() : null;
            return live || { state: st.state, reason: st.reason };
        },
        sent: () => sent,
        release() {
            stopped = true;
            if (timer !== null) { clock.clearTimeout(timer); timer = null; }
            return Promise.resolve().then(() => backend.release()).catch((e) => log.warn('light release: ' + e));
        },
        hold(seconds) {
            stopped = true;
            pending = null;
            if (timer !== null) { clock.clearTimeout(timer); timer = null; }
            const frame = sent || inflight;
            if (!frame || typeof backend.hold !== 'function') return Promise.resolve();
            return Promise.resolve().then(() => backend.hold(C.toWire(frame, backend.capabilities), seconds)).catch((e) => log.warn('light hold: ' + e));
        },
        extinguish() {
            stopped = true;
            if (timer !== null) { clock.clearTimeout(timer); timer = null; }
            const off = typeof backend.extinguish === 'function' ? backend.extinguish : backend.release;
            return Promise.resolve().then(() => off.call(backend)).catch((e) => log.warn('light off: ' + e));
        },
    };
}

module.exports = { createBackend, createSender, BACKOFF, MAX_FAILS };
