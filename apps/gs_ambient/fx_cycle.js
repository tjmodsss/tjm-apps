'use strict';
/**
 * Farbverlauf: both zones run through the whole wheel at full saturation, together or half a turn apart.
 * Tempo is the number on the button (1,00 … 10,00). 10,00 is one full turn in 150 seconds, the fastest
 * the car still shows as a blend. 1,00 is ten times slower. A turn never takes less than 150 seconds.
 */
const C = require('./color');

const LAP_AT_MAX = 150;
const SPEED_MAX = 10;

function lapSeconds(speed) {
    let s = typeof speed === 'number' && isFinite(speed) ? speed : 5.5;
    if (s < 1) s = 1;
    if (s > SPEED_MAX) s = SPEED_MAX;
    return (LAP_AT_MAX * SPEED_MAX) / s;
}

module.exports = {
    id: 'cycle',
    name: 'Farbverlauf',
    needs: [],
    swatch: [[255, 48, 48], [255, 208, 0], [16, 254, 50], [0, 229, 255], [32, 80, 255], [255, 48, 255]],
    params: [
        { key: 'speed', label: 'Tempo', type: 'range', min: 1, max: SPEED_MAX, step: 0.05, default: 5.5 },
        { key: 'zones', label: 'Zonen', type: 'choice', options: [['same', 'Gleich'], ['offset', 'Versetzt']], default: 'same' },
    ],
    usesBase: () => false,
    run(t, inputs, p, base) {
        const h = (t / lapSeconds(p.speed)) * 360, upper = C.hsvToRgb(h, 1, 1);
        return { upper, lower: p.zones === 'offset' ? C.hsvToRgb(h + 180, 1, 1) : upper, brightness: base.brightness };
    },
    lapSeconds,
};
