'use strict';
/**
 * safety.js - nothing may throw out of a callback: the kit exits the app on an uncaught exception
 * (kit/runtime/mgu.js), and on the car an app's first crash wipes its data and the second uninstalls it.
 *
 *   guard(name, fn)  fn wrapped: a throw (or a rejected promise) is logged and counted, never rethrown.
 *                    errorLimit errors within errorWindowMs trip the safety: onTrip handlers run once
 *                    (the engine unit reads stop) and tripped() stays true until reset().
 *   pollKill(fs, p)  true while the kill file exists; a check that fails counts as killed (no engine unit
 *                    reads is the safe side, KB-ANY-181).
 * Copy of apps/adam_shiftlights/safety.js with Engine Vitals' wording.
 */
const path = require('path');

const LOG_EVERY_MS = 10000;     // at most one log line per guarded name in this time

function createSafety(o) {
    const S = o.cfg.safety, log = o.log, now = o.now || Date.now;
    let errors = [], isTripped = false;
    const trips = [], lastLog = Object.create(null);

    function record(name, e) {
        const t = now();
        try {
            if (!(lastLog[name] > t - LOG_EVERY_MS)) { lastLog[name] = t; log.error('error in ' + name + ': ' + (e && e.stack || e)); }
        } catch (x) { /* the log itself failed: still count it */ }
        errors = errors.filter((x) => x > t - S.errorWindowMs).concat([t]);
        if (!isTripped && errors.length >= S.errorLimit) {
            isTripped = true;
            try { log.error('STOPPED after ' + errors.length + ' errors in ' + S.errorWindowMs + ' ms: engine unit reads stopped until the app restarts (the screen keeps showing the car signals)'); } catch (x) { /* ignore */ }
            trips.forEach((fn) => { try { fn(); } catch (x) { /* a trip handler must not throw either */ } });
        }
    }

    function guard(name, fn) {
        return function guarded() {
            try {
                const r = fn.apply(this, arguments);
                if (r && typeof r.then === 'function') return r.then(null, (e) => { record(name, e); });
                return r;
            } catch (e) {
                record(name, e);
                return undefined;
            }
        };
    }

    return {
        guard,
        tripped: () => isTripped,
        onTrip: (fn) => { trips.push(fn); },
        reset: () => { isTripped = false; errors = []; },
        killFile: (dataDir) => path.join(dataDir, S.killFile),
        pollKill: (fs, p) => { try { return fs.existsSync(p); } catch (e) { return true; } },
    };
}

module.exports = { createSafety };
