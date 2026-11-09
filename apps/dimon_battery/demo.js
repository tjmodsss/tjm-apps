'use strict';
/**
 * Synthetic 12 V battery so the screen is alive with no car present. A 30 s loop:
 * the engine runs and the alternator charges, then the car rests, then a short load
 * (lights / blower) with the engine off. reading(t) returns scaled values.
 */
class Demo {
    constructor() { this.t0 = null; this.soc = 86; this.soh = 92; }
    reading(t) {
        if (this.t0 == null) this.t0 = t;
        const e = ((t - this.t0) / 1000) % 30;
        let voltage, current;
        if (e < 16) {                       // engine running, alternator charging
            current = 38 * Math.exp(-e / 6) + 3 + Math.sin(e) * 1.5;
            voltage = 14.1 + Math.sin(e / 2) * 0.12;
        } else if (e < 24) {                // at rest
            current = Math.sin(e) * 0.3;
            voltage = 12.62 + Math.sin(e) * 0.03;
        } else {                            // a load with the engine off
            current = -18 - Math.sin(e) * 4;
            voltage = 12.30 + Math.sin(e) * 0.05;
        }
        return { voltage: voltage, current: current, soc: this.soc, soh: this.soh, temp: 27 };
    }
}
module.exports = Demo;
