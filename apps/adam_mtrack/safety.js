'use strict';
/**
 * safety.js - nothing may throw out of a callback: the kit exits the app on an uncaught exception
 * (kit/runtime/mgu.js), and on the car an app's first crash wipes its data and the second uninstalls it.
 *
 *   guard(name, fn)  fn wrapped: a throw (or a rejected promise) is logged and counted, never rethrown.
 *                    errorLimit errors within errorWindowMs trip the safety: onTrip handlers run once
 *                    (output drops everything) and tripped() stays true until reset().
 *   onError(fn)      fn(name) after every recorded error: main.js drops the cover at once and restarts its hold.
 *   lastErrorAt()    when the last error was recorded (now()'s clock), or null.
 *   pollKill(fs, p)  true while the kill file exists; a check that fails counts as killed (output off is
 *                    the safe side, KB-ANY-181).
 * Copy of apps/adam_shiftlights/safety.js with M Track wording, plus onError and lastErrorAt.
 */
const path = require('path');

const LOG_EVERY_MS = 10000;     // at most one log line per guarded name in this time

function createSafety(o) {
    const S = o.cfg.safety, log = o.log, now = o.now || Date.now;
    let errors = [], isTripped = false;
    const trips = [], errs = [], lastLog = Object.create(null);
    let lastAt = null;

    function record(name, e) {
        const t = now();
        try {
            if (!(lastLog[name] > t - LOG_EVERY_MS)) { lastLog[name] = t; log.error('error in ' + name + ': ' + (e && e.stack || e)); }
        } catch (x) { /* the log itself failed: still count it */ }
        errors = errors.filter((x) => x > t - S.errorWindowMs).concat([t]);
        lastAt = t;
        errs.forEach((fn) => { try { fn(name); } catch (x) { /* an error handler must not throw either */ } });
        if (!isTripped && errors.length >= S.errorLimit) {
            isTripped = true;
            try { log.error('STOPPED after ' + errors.length + ' errors in ' + S.errorWindowMs + ' ms: the cover is off until Cover the cluster is turned off and on'); } catch (x) { /* ignore */ }
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
        onError: (fn) => { errs.push(fn); },
        lastErrorAt: () => lastAt,
        reset: () => { isTripped = false; errors = []; },
        killFile: (dataDir) => path.join(dataDir, S.killFile),
        pollKill: (fs, p) => { try { return fs.existsSync(p); } catch (e) { return true; } },
    };
}

module.exports = { createSafety };
