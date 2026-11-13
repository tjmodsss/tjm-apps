'use strict';
/**
 * vehicle.js - whether the car lets the games play right now (pure logic: main.js feeds it signals).
 *
 *   const v = new Vehicle();
 *   v.speed(kmh) / v.speedRaw(struct)
 *   v.state(opts) -> { moving }
 *
 * The rule (GAMES.md): the app plays only while the car stands (<= MAX_KMH, 15 km/h). No speed at all (a
 * bench, the emulator's demo) counts as standing. Every game is played with the iDrive knob (and
 * touch); the steering wheel and the pedals are not inputs.
 */
const MAX_KMH = 15;

class Vehicle {
    constructor() { this.kmh = null; }
    speed(kmh) { if (typeof kmh === 'number' && isFinite(kmh)) this.kmh = kmh; }
    /** Vehicle2.statusCarSpeed2 */
    speedRaw(v) { const k = v && v.speedVehicleCentreOfGravity; if (typeof k === 'number' && k !== 65535) this.speed(k * 0.015625); }
    /** Always on: there is no setting to turn it off. */
    state() {
        return { moving: this.kmh !== null && this.kmh > MAX_KMH };
    }
}

module.exports = { Vehicle, MAX_KMH };
