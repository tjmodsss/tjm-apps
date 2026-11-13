'use strict';
/**
 * rpmpoll.js - "Fast RPM": read CDS statusEngineSpeed2 with its getter when the car's change notifications
 * are slower than cfg.pollMs, plus the rpm rate stats for the 30 s log line. Node 8.
 *
 *   const poll = createRpmPoll({ cfg: cfg.rpm, log, enabled: () => bool });
 *   handlers.statusEngineSpeed2 = poll.wrap(carHandler);   // the subscription path: counts notifications
 *   poll.attach(watchResult, carHandler);                 // signals.watch's { available, proxy }
 *   poll.start();                                          // after every watch has settled (no getter during buildProxy)
 *   poll.stats() -> the last window's rates, then resets
 *
 * One getter call in flight at most, on a chained timer (never setInterval), from a fresh setImmediate tick as
 * signals.js does. While notifications arrive faster than pollMs no getter is called. Failures (reject, timeout,
 * a throw, no value, a throwing handler) double the wait up to pollMaxBackoffMs and never reach safety.guard:
 * a slow car is not a bug. Nothing here throws.
 */
const FIELD = 'statusEngineSpeed2';
const CAP = 2000;           // entries kept per stats window
const WARN_MS = 30000;      // at most one failure warning this often

/** Nearest-rank percentile of a list of numbers, null when empty. */
function pct(list, p) {
    if (!list.length) return null;
    const s = list.slice().sort((a, b) => a - b);
    return s[Math.max(0, Math.ceil(p * s.length) - 1)];
}

function createRpmPoll(o) {
    const R = o.cfg, log = o.log, enabled = o.enabled;
    const now = o.now || Date.now, later = o.setTimeout || setTimeout, clear = o.clearTimeout || clearTimeout, soon = o.setImmediate || setImmediate;
    let res = null, handler = null, timer = null, running = false, busy = false;
    let backoff = R.pollMs, lastRpmAt = -Infinity, lastWarn = -Infinity;
    let notes = [], rtts = [], polls = 0, fails = 0, since = now();
    const keep = (list, v) => { if (list.length < CAP) list.push(v); };

    const schedule = (ms) => { if (running && timer === null) timer = later(tick, ms); };

    function fail(why) {
        fails++;
        backoff = Math.min(backoff * 2, R.pollMaxBackoffMs);
        const t = now();
        if (t - lastWarn >= WARN_MS) { lastWarn = t; log.warn('rpm poll: ' + why + ' (next in ' + backoff + ' ms)'); }
        schedule(backoff);
    }

    function done(t0, err, v) {
        busy = false;
        let e = err;
        if (!e && (!v || typeof v !== 'object')) e = 'no value';
        if (!e) {
            lastRpmAt = now();
            try { handler(v); } catch (x) { e = 'handler: ' + x; }
        }
        if (e) { fail(String(e)); return; }
        polls++;
        keep(rtts, now() - t0);
        backoff = R.pollMs;
        schedule(R.pollMs);
    }

    function request() {
        const t0 = now();
        try {
            Promise.resolve(res.proxy.getValue(FIELD, R.pollTimeoutMs)).then((v) => done(t0, null, v), (x) => done(t0, x || 'rejected'));
        } catch (x) { done(t0, x || 'threw'); }
    }

    function tick() {
        timer = null;
        if (!running || busy) return;
        let ready = false;
        try { ready = !!(enabled() && res && res.proxy && res.available && typeof handler === 'function'); } catch (x) { ready = false; }
        if (!ready) { schedule(R.pollIdleMs); return; }
        const age = now() - lastRpmAt;
        if (age < R.pollMs) { schedule(R.pollMs - age); return; }
        busy = true;
        soon(request);
    }

    return {
        wrap: (fn) => (v) => { const t = now(); keep(notes, t); lastRpmAt = t; return fn(v); },
        attach(r, fn) { res = r || null; handler = fn; },
        start() { if (running) return; running = true; schedule(0); },
        stop() { running = false; if (timer !== null) { clear(timer); timer = null; } },
        stats() {
            const t = now(), s = Math.max(1, t - since) / 1000;
            const gaps = notes.slice(1).map((x, i) => x - notes[i]);
            const out = {
                notified: notes.length / s, gapP50: pct(gaps, 0.5), gapP90: pct(gaps, 0.9),
                polled: polls / s, rttP50: pct(rtts, 0.5), rttMax: pct(rtts, 1), fails,
            };
            notes = []; rtts = []; polls = 0; fails = 0; since = t;
            return out;
        },
    };
}

module.exports = { createRpmPoll, pct };
