'use strict';
/**
 * track.js - turns the engine unit's misfire counters into a log of every misfire, across drives.
 * No car in it (tested on a PC).
 *
 * The engine unit (DME) counts misfires per cylinder over OBD service 06 (SAE J1979):
 *   MID A2..A7 = cylinder 1..6, TID 0C = misfires this driving cycle (from engine start),
 *   TID 0B = a weighted average over the last 10 driving cycles.
 * The 0C count only grows during a drive and starts again at 0 on the next one, so the log is the
 * difference between one reading and the next: each rise is an event (when, which cylinder, how many,
 * and what the car was doing), and a count lower than the last one is a new drive.
 *
 *   const t = new Tracker(saved);
 *   const ev = t.feed([0, 2, 0, 0, 0, 0], Date.now(), { rpm, speed, coolant, oil, gear, torque, mode }, avg10);
 *   t.state   -> { drive, drives, events, totals, last, avg10, reads }   (JSON, saved by the app)
 *
 * Node 8: no ?., ??, object spread or optional catch binding.
 */

const MAX_EVENTS = 2000;     // events kept (the oldest go first)
const MAX_DRIVES = 300;      // drives kept
const NEW_DRIVE_GAP_MS = 10 * 60000;   // no reading for this long and counts back at 0: a new drive too

class Tracker {
    constructor(saved) {
        const s = saved || {};
        this.state = {
            drive: s.drive || null,          // the drive now: { id, start, end, counts: [per cylinder], first: [counts at the first reading], avg10 }
            drives: s.drives || [],          // drives done: same shape
            events: s.events || [],          // { at, drive, cyl (1..), n, ctx, early }
            totals: s.totals || [],          // all misfires logged, per cylinder
            last: s.last || null,            // the last reading: { at, counts }
            avg10: s.avg10 || null,          // the engine unit's 10-drive average, last read
            reads: s.reads || 0,
        };
    }

    /**
     * One reading. counts: per cylinder (null = no value for that one). Returns the new events.
     * A reading that starts a drive with misfires already counted (they came before the app read
     * anything, e.g. on a cold start) gives events marked early: their time and conditions are the
     * first reading's, not the misfires' own.
     */
    feed(counts, at, ctx, avg10) {
        const S = this.state;
        if (!Array.isArray(counts) || !counts.length) return [];
        S.reads++;
        if (Array.isArray(avg10) && avg10.length === counts.length) S.avg10 = avg10.slice();
        const prev = S.last && S.last.counts && S.last.counts.length === counts.length ? S.last.counts : null;
        const dropped = prev && counts.some((c, i) => num(c) && num(prev[i]) && c < prev[i]);
        const stale = S.last && at - S.last.at > NEW_DRIVE_GAP_MS && counts.every((c) => !num(c) || c === 0);
        const fresh = !S.drive || dropped || stale;
        const out = [];
        if (fresh) {
            this._endDrive();
            S.drive = { id: (S.drives.length ? S.drives[S.drives.length - 1].id : 0) + 1, start: at, end: at, counts: counts.map(() => 0), first: counts.slice(), avg10: S.avg10 ? S.avg10.slice() : null };
            // the counts a new drive starts with happened before the first reading of it
            counts.forEach((c, i) => { if (num(c) && c > 0) out.push(this._event(at, i, c, ctx, true)); });
        } else {
            counts.forEach((c, i) => {
                const p = prev ? prev[i] : null;
                if (num(c) && num(p) && c > p) out.push(this._event(at, i, c - p, ctx, false));
            });
        }
        S.drive.end = at;
        S.last = { at: at, counts: counts.slice() };
        if (S.events.length > MAX_EVENTS) S.events.splice(0, S.events.length - MAX_EVENTS);
        return out;
    }

    _event(at, i, n, ctx, early) {
        const S = this.state;
        while (S.totals.length <= i) S.totals.push(0);
        while (S.drive.counts.length <= i) S.drive.counts.push(0);
        S.totals[i] += n;
        S.drive.counts[i] += n;
        const e = { at: at, drive: S.drive.id, cyl: i + 1, n: n, ctx: ctx || {}, early: !!early };
        S.events.push(e);
        return e;
    }

    _endDrive() {
        const S = this.state;
        if (!S.drive) return;
        S.drives.push(S.drive);
        if (S.drives.length > MAX_DRIVES) S.drives.splice(0, S.drives.length - MAX_DRIVES);
        S.drive = null;
    }

    /** Misfires this drive (sum), and per cylinder. */
    driveTotal() { return this.state.drive ? sum(this.state.drive.counts) : 0; }

    /** The cylinder with the most misfires logged (1..), or 0 when none. */
    worst(counts) {
        let best = -1, at = 0;
        (counts || this.state.totals).forEach((c, i) => { if (num(c) && c > best) { best = c; at = i + 1; } });
        return best > 0 ? at : 0;
    }

    /** The drives with at least one misfire, of the last n drives (the one now included). */
    recentDrives(n) {
        const all = this.state.drives.concat(this.state.drive ? [this.state.drive] : []);
        return all.slice(-n);
    }
}

function num(x) { return typeof x === 'number' && isFinite(x); }
function sum(a) { return (a || []).reduce((s, x) => s + (num(x) ? x : 0), 0); }

/** How serious a drive's count looks: 'ok' (none), 'few' (a handful, often normal on a cold start), 'many'. */
function severity(n, threshold) {
    if (!n) return 'ok';
    return n >= (threshold || 10) ? 'many' : 'few';
}

/** The log as CSV (time, drive, cylinder, count, early, rpm, speed, coolant, oil, gear, torque, mode). */
function csv(events) {
    const head = 'time,drive,cylinder,misfires,before_first_reading,rpm,speed_kmh,coolant_c,oil_c,gear,torque_nm,drive_mode';
    const q = (v) => (v === undefined || v === null ? '' : String(v).replace(/,/g, ' '));
    return [head].concat(events.map((e) => {
        const c = e.ctx || {};
        return [new Date(e.at).toISOString(), e.drive, e.cyl, e.n, e.early ? 'yes' : 'no', q(round(c.rpm)), q(round(c.speed)), q(round(c.coolant)), q(round(c.oil)), q(c.gear), q(round(c.torque)), q(c.mode)].join(',');
    })).join('\n') + '\n';
}
function round(x) { return num(x) ? Math.round(x) : x; }

module.exports = { Tracker, severity, csv, sum };
