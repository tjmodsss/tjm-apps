'use strict';
/**
 * Demo - a synthetic car lapping a circuit, so the screen is alive with no car present.
 * speed(t) oscillates like a lap (fast straights, slow corners); due(t), called each
 * tick, says when to close a sector or a lap so the app drives its own LapTimer.
 * Demo laps are short (about 11 s, three sectors) so results appear quickly.
 */

class Demo {
    constructor() {
        this.t0 = null;
        this.lapLen = 11000;                  // ms per demo lap
        this.sectorLen = this.lapLen / 3;
        this._laps = 0;
        this._sectors = 0;
    }

    /** Speed in km/h for absolute time t (ms): two straights with corners between. */
    speed(t) {
        if (this.t0 == null) this.t0 = t;
        const p = ((t - this.t0) % this.lapLen) / this.lapLen;           // 0..1 within the lap
        const osc = Math.sin(p * Math.PI * 2) * 0.5 + Math.sin(p * Math.PI * 6) * 0.22;
        return Math.max(45, 120 + 75 * osc);
    }

    /** Called every tick: { lap, sector } when a demo lap or sector boundary has passed. */
    due(t) {
        if (this.t0 == null) this.t0 = t;
        const e = t - this.t0;
        const out = { lap: false, sector: false };
        const laps = Math.floor(e / this.lapLen);
        if (laps > this._laps) {                 // a lap boundary is also a sector boundary: fire the lap only
            this._laps = laps;
            this._sectors = Math.floor(e / this.sectorLen);
            out.lap = true;
            return out;
        }
        const sectors = Math.floor(e / this.sectorLen);
        if (sectors > this._sectors) { this._sectors = sectors; out.sector = true; }
        return out;
    }
}

module.exports = Demo;
