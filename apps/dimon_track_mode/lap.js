'use strict';
/**
 * LapTimer - a manual-trigger lap timer. The MGU exposes no GPS position over SOME/IP
 * (the apps here read speed and acceleration, not latitude/longitude), so a lap is
 * marked by a press at the start/finish line; a press within a lap can also split a
 * sector. Best lap, best sector per index and the theoretical best are kept so the
 * screen can show a live delta.
 *
 * Pure logic, clock passed in (ms), no timers of its own: feed(t, speedKmh) tracks the
 * speed, sector(t) closes a sector, lap(t) closes the lap (and its final sector) and
 * opens the next. The first lap() (or the first movement with autoStart) starts timing.
 */

class LapTimer {
    /** opts: { onLap(lap, deltaToBest) } */
    constructor(opts) {
        this.onLap = (opts && opts.onLap) || function () {};
        this.reset();
    }

    reset() {
        this.running = false;
        this.lapStart = null;       // ms the current lap started
        this.sectorStart = null;    // ms the current sector started
        this.sectors = [];          // closed sector times of the current lap (s)
        this.laps = [];             // completed laps, newest first
        this.best = null;           // best lap object
        this.bestSectors = [];      // best time seen for each sector index (s)
        this.maxSpeed = 0;          // of the current lap
        this._sum = 0;
        this._n = 0;
        this.lastSpeed = null;
        this.lapCount = 0;
    }

    feed(t, speed) {
        if (typeof speed !== 'number' || !isFinite(speed)) return;
        this.lastSpeed = speed;
        if (this.running) {
            if (speed > this.maxSpeed) this.maxSpeed = speed;
            this._sum += speed;
            this._n++;
        }
    }

    elapsed(t) { return this.running && this.lapStart != null ? Math.max(0, (t - this.lapStart) / 1000) : 0; }
    sectorElapsed(t) { return this.running && this.sectorStart != null ? Math.max(0, (t - this.sectorStart) / 1000) : 0; }

    /** Close the current sector and open the next, within the same lap. */
    sector(t) {
        if (!this.running) return;
        this.sectors.push(Math.max(0, (t - this.sectorStart) / 1000));
        this.sectorStart = t;
    }

    /** Close the current lap (and its final sector) and open the next. The first call starts timing. */
    lap(t) {
        if (!this.running) { this._start(t); return null; }
        const finalSector = Math.max(0, (t - this.sectorStart) / 1000);
        const sectors = this.sectors.concat([finalSector]);
        const time = Math.max(0, (t - this.lapStart) / 1000);
        const lap = {
            n: ++this.lapCount,
            time: time,
            sectors: sectors,
            maxSpeed: this.maxSpeed,
            avgSpeed: this._n ? this._sum / this._n : 0,
            at: t,
        };
        this.laps.unshift(lap);
        const prevBest = this.best;
        if (!this.best || time < this.best.time) this.best = lap;
        sectors.forEach(function (s, i) {
            if (this.bestSectors[i] == null || s < this.bestSectors[i]) this.bestSectors[i] = s;
        }, this);
        lap.delta = prevBest ? time - prevBest.time : null;
        this.onLap(lap, lap.delta);
        this._start(t);
        return lap;
    }

    _start(t) {
        this.running = true;
        this.lapStart = t;
        this.sectorStart = t;
        this.sectors = [];
        this.maxSpeed = 0;
        this._sum = 0;
        this._n = 0;
    }

    /** Stop timing without recording a lap (e.g. pulled into the pits). */
    stop() { this.running = false; this.lapStart = null; this.sectorStart = null; }

    /** The theoretical best lap: the sum of the best sector times, once every sector index has one. */
    optimal() {
        if (!this.bestSectors.length) return null;
        var total = 0;
        for (var i = 0; i < this.bestSectors.length; i++) {
            if (this.bestSectors[i] == null) return null;
            total += this.bestSectors[i];
        }
        return total;
    }
}

module.exports = { LapTimer };
