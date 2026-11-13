'use strict';
/**
 * inputs.js - what the effects read: the kit's driving data (car.js data()) and, with demo data, a
 * simulated driving mode (20 s each: eco, comfort, sport) and music level. On the car the driving mode
 * and the music level are null until a source for them is found (docs/am-auto-pruefen.md).
 */
const num = (x) => (typeof x === 'number' && isFinite(x) ? x : null);
const MODES = ['eco', 'comfort', 'sport'];

/** A beat: two pulses a second, louder and softer over 7 s. */
function beat(t) {
    const p = (t * 2) % 1;
    return Math.max(0, 1 - p * 3) * (0.6 + 0.4 * Math.sin(t * 2 * Math.PI / 7));
}

function readInputs(d, t) {
    const c = d || {}, demo = !!c.demo;
    return {
        rpm: num(c.rpm), speed: num(c.speed), gLong: num(c.gLong), gLat: num(c.gLat),
        mode: demo ? MODES[Math.floor(t / 20) % MODES.length] : null,
        music: demo ? Math.min(1, Math.max(0, beat(t))) : null,
        demo,
    };
}

module.exports = { readInputs };
