'use strict';
/**
 * dragy.js - learns how far Drive Log's 0-60 times (the car's wheel speed) are from a Dragy's (GPS), so a
 * run can be shown as "what a Dragy would have said" once there are enough runs timed both ways.
 *
 *   const cal = new DragyCal(saved);       // saved: the runs from the data file
 *   cal.addRun(atMs, carSeconds)           // every 0-60 Drive Log times
 *   cal.pending()                          // the newest run still waiting for its Dragy time, or null
 *   cal.setDragy(id, seconds) / skip(id)   // the Dragy time for a run, or no Dragy time for it
 *   cal.stats()                            // { n, offset, spread, ready } over the runs timed both ways
 *   cal.adjusted(carSeconds)               // carSeconds + offset once ready, else null
 *
 * The model is an offset: Dragy minus car, the median of the pairs. Most of the gap is the same on every
 * run (wheel speed reading high, a Dragy's rollout setting, the car's signal lag), and a median ignores the
 * odd bad pair (a launch with wheelspin, a Dragy with weak satellites). With READY_N pairs or more it is
 * used; spread (the median distance of the pairs from it) says how far one adjusted run can be off.
 * Enter Dragy times the same way every time (with or without its 1-ft rollout).
 *
 * Node 8: no ?., ??, object spread or optional catch binding.
 */

const READY_N = 3;
const MAX_RUNS = 200;
const PENDING_MS = 7 * 24 * 3600 * 1000;      // a run older than this no longer asks for its Dragy time

const median = (a) => { const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null; };
const r2 = (x) => Math.round(x * 100) / 100;

class DragyCal {
    constructor(saved) {
        this.runs = Array.isArray(saved) ? saved : [];   // [{ id, at, car, dragy: seconds | null, skipped }]
    }

    addRun(at, car) {
        const id = 'r' + at.toString(36);
        this.runs.push({ id, at, car: r2(car), dragy: null, skipped: false });
        if (this.runs.length > MAX_RUNS) this.runs = this.runs.slice(this.runs.length - MAX_RUNS);
        return id;
    }

    pending(now) {
        const t = now || Date.now();
        for (let i = this.runs.length - 1; i >= 0; i--) {
            const r = this.runs[i];
            if (t - r.at > PENDING_MS) return null;
            if (r.dragy === null && !r.skipped) return r;
        }
        return null;
    }

    _find(id) { for (let i = 0; i < this.runs.length; i++) if (this.runs[i].id === id) return this.runs[i]; return null; }
    setDragy(id, s) { const r = this._find(id); if (r && s > 1 && s < 30) { r.dragy = r2(s); r.skipped = false; } return r; }
    skip(id) { const r = this._find(id); if (r) r.skipped = true; return r; }

    pairs() { return this.runs.filter((r) => r.dragy !== null); }

    stats() {
        const d = this.pairs().map((r) => r.dragy - r.car);
        if (!d.length) return { n: 0, offset: null, spread: null, ready: false };
        const off = median(d), spread = median(d.map((x) => Math.abs(x - off)));
        return { n: d.length, offset: r2(off), spread: r2(spread), ready: d.length >= READY_N };
    }

    adjusted(car) {
        const s = this.stats();
        return s.ready && car !== null && car !== undefined ? r2(car + s.offset) : null;
    }

    /** A first guess to start the entry from: the adjusted time once known, else the car's own. */
    guess(car) { const a = this.adjusted(car); return a !== null ? a : r2(car); }
}

module.exports = { DragyCal, READY_N, median };
