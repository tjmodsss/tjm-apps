'use strict';
/**
 * trip.js - Drive Log's logic, with no car in it (so it can be tested on a PC).
 *
 *   const tr = new Trips(saved);            // saved: { trips, current } from the data file, or nothing
 *   tr.feed(d, tMs)                          // one sample: { speed km/h, rpm, gLong, gLat (g), oil, coolant (C), stage }
 *   tr.end(tMs)                              // the car is switching off: close the drive now
 *   tr.current / tr.trips / tr.state()       // the drive going on (or null), the finished ones, what to save
 *   tr.newRuns                               // 0-60 runs timed since last emptied (the app takes them)
 *
 * A drive starts when the car first moves (5 km/h) and ends after PARK_MS in P, or STOP_MS standing still,
 * or when the app is told the car is switching off. Drives under MIN_KM are dropped (moving the car in the
 * driveway). A 0-60 mph run is timed from the moment the car leaves a standstill to 60 mph (96.56 km/h);
 * lifting off on the way (speed falling) cancels it. The speed is the car's own wheel speed, not GPS.
 *
 * Node 8: no ?., ??, object spread or optional catch binding.
 */

const START_KMH = 5;
const PARK_MS = 30000;
const STOP_MS = 300000;
const MIN_KM = 0.2;
const MAX_DT_MS = 2000;          // a gap in the samples longer than this adds no distance
const RUN_KMH = 96.5604;         // 60 mph
const MAX_TRIPS = 300;

function blank(t) {
    return { start: t, end: t, km: 0, movingMs: 0, topKmh: 0, peakRpm: 0, maxAccelG: 0, maxBrakeG: 0, maxLatG: 0,
        oilMax: null, coolantMax: null, best060: null, runs060: 0 };
}

class Trips {
    constructor(saved) {
        const s = saved || {};
        this.trips = Array.isArray(s.trips) ? s.trips : [];
        this.current = null;
        this.last = null;            // { t, kmh } the previous sample
        this.parkSince = 0; this.stopSince = 0;
        this.run = null;             // { t0, top } a 0-60 run going on
        this.armed = false;          // standing still: the next start can be a run
        this.newRuns = [];           // 0-60 runs timed since the app last took them: [{ at, s }]
        // a drive the car switched off in the middle of (the app was stopped with it): keep it as it was
        if (s.current && s.current.km >= MIN_KM) this._push(s.current);
    }

    feed(d, t) {
        const kmh = isFinite(d.speed) ? d.speed : null;
        if (kmh === null) return;
        const prev = this.last;
        this.last = { t, kmh };
        if (!this.current) {
            if (kmh < 1) this.armed = true;
            if (kmh >= START_KMH) {
                this.current = blank(prev ? prev.t : t);
                this.parkSince = 0; this.stopSince = 0;
            } else {
                // a run can begin before the drive "starts" at 5 km/h
                this._run(prev, kmh, t);
                return;
            }
        }
        const c = this.current;
        c.end = t;
        if (prev) {
            const dt = t - prev.t;
            if (dt > 0 && dt <= MAX_DT_MS) {
                c.km += ((prev.kmh + kmh) / 2) * dt / 3600000;
                if (kmh > 1) c.movingMs += dt;
            }
        }
        if (kmh > c.topKmh) c.topKmh = kmh;
        if (isFinite(d.rpm) && d.rpm > c.peakRpm) c.peakRpm = d.rpm;
        if (isFinite(d.gLong)) { if (d.gLong > c.maxAccelG) c.maxAccelG = d.gLong; if (-d.gLong > c.maxBrakeG) c.maxBrakeG = -d.gLong; }
        if (isFinite(d.gLat) && Math.abs(d.gLat) > c.maxLatG) c.maxLatG = Math.abs(d.gLat);
        if (isFinite(d.oil) && (c.oilMax === null || d.oil > c.oilMax)) c.oilMax = d.oil;
        if (isFinite(d.coolant) && (c.coolantMax === null || d.coolant > c.coolantMax)) c.coolantMax = d.coolant;
        this._run(prev, kmh, t);
        // the end of the drive: in P for a while, or standing still for longer
        if (d.stage === 'P' && kmh < 1) { if (!this.parkSince) this.parkSince = t; } else this.parkSince = 0;
        if (kmh < 1) { if (!this.stopSince) this.stopSince = t; } else this.stopSince = 0;
        if ((this.parkSince && t - this.parkSince >= PARK_MS) || (this.stopSince && t - this.stopSince >= STOP_MS)) this.end(t);
    }

    _run(prev, kmh, t) {
        if (kmh < 1) { this.run = null; this.armed = true; return; }
        if (!this.run && this.armed && prev && prev.kmh < 1) { this.run = { t0: prev.t + (t - prev.t) * ((1 - prev.kmh) / Math.max(0.01, kmh - prev.kmh)), top: kmh }; this.armed = false; }
        if (!this.run) return;
        if (kmh < this.run.top - 3) { this.run = null; return; }          // lifted: not a run
        if (kmh > this.run.top) this.run.top = kmh;
        if (kmh >= RUN_KMH) {
            // the crossing, between the two samples
            const tc = prev && prev.kmh < RUN_KMH ? prev.t + (t - prev.t) * ((RUN_KMH - prev.kmh) / Math.max(0.01, kmh - prev.kmh)) : t;
            const s = (tc - this.run.t0) / 1000;
            if (this.current && s > 1.5 && s < 30) {
                this.newRuns.push({ at: Math.round(tc), s: Math.round(s * 100) / 100 });
                this.current.runs060++;
                if (this.current.best060 === null || s < this.current.best060) this.current.best060 = Math.round(s * 100) / 100;
            }
            this.run = null;
        }
    }

    /** Close the drive going on (car switching off, or the end rules above). */
    end(t) {
        const c = this.current;
        this.current = null; this.run = null; this.parkSince = 0; this.stopSince = 0;
        if (!c) return null;
        if (t) c.end = Math.max(c.end, Math.min(t, c.end + 60000));
        if (c.km < MIN_KM) return null;
        this._push(c);
        return c;
    }

    _push(c) {
        ['km', 'topKmh', 'peakRpm', 'maxAccelG', 'maxBrakeG', 'maxLatG'].forEach((k) => { c[k] = Math.round(c[k] * 100) / 100; });
        this.trips.push(c);
        if (this.trips.length > MAX_TRIPS) this.trips = this.trips.slice(this.trips.length - MAX_TRIPS);
    }

    state() { return { trips: this.trips, current: this.current }; }

    /** The best 0-60 of all drives kept, or null. */
    best060() {
        let b = null;
        this.trips.concat(this.current ? [this.current] : []).forEach((c) => { if (c.best060 !== null && (b === null || c.best060 < b)) b = c.best060; });
        return b;
    }
}

/** CSV of the drives (US or metric units). */
function csv(trips, units) {
    const us = units !== 'metric';
    const head = ['start', 'end', us ? 'miles' : 'km', 'moving_min', us ? 'top_mph' : 'top_kmh', 'best_0_60_s', 'runs_0_60', 'peak_rpm',
        'max_accel_g', 'max_brake_g', 'max_lateral_g', us ? 'oil_max_f' : 'oil_max_c', us ? 'coolant_max_f' : 'coolant_max_c'];
    const T = (c) => (c === null || c === undefined ? '' : us ? Math.round(c * 1.8 + 32) : Math.round(c));
    const rows = trips.map((c) => [new Date(c.start).toISOString(), new Date(c.end).toISOString(),
        (us ? c.km * 0.621371 : c.km).toFixed(2), (c.movingMs / 60000).toFixed(1), Math.round(us ? c.topKmh * 0.621371 : c.topKmh),
        c.best060 === null ? '' : c.best060, c.runs060, Math.round(c.peakRpm), c.maxAccelG, c.maxBrakeG, c.maxLatG, T(c.oilMax), T(c.coolantMax)].join(','));
    return [head.join(',')].concat(rows).join('\n') + '\n';
}

module.exports = { Trips, csv, RUN_KMH, START_KMH, PARK_MS, STOP_MS, MIN_KM };
