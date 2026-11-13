'use strict';
/**
 * Favoriten: walk the saved pairs of the group that is open. Upper and lower each take the short
 * way round the wheel toward the next pair, then the way back is the same path in reverse.
 * Tempo is the Farbverlauf tempo: the longer zone moves at that hue rate, the shorter one arrives with it.
 */
const C = require('./color');
const { lapSeconds } = require('./fx_cycle');

function col(f, z) {
    const c = f[z + 'C'];
    return c ? c : { h: 0, s: 1 };
}
function span(a, b) {
    return Math.abs(((b.h - a.h + 540) % 360) - 180);
}

module.exports = {
    id: 'pairs',
    name: 'Favoriten',
    needs: [],
    swatch: [[255, 96, 32], [255, 48, 96], [96, 48, 255]],
    params: [
        { key: 'speed', label: 'Tempo', type: 'range', min: 1, max: 10, step: 0.05, default: 5.5 },
    ],
    usesBase: () => false,
    available: (base) => (base.favs.length >= 2 ? null : 'Mindestens 2 Favoriten nötig'),
    run(t, inputs, p, base, mem) {
        const list = base.favs;
        const n = list.length;
        if (mem.i === undefined || mem.i < 0 || mem.i >= n) { mem.i = 0; mem.dir = 1; mem.u = 0; mem.last = t; }
        let dt = t - mem.last;
        mem.last = t;
        if (!(dt >= 0)) dt = 0;
        const rate = 360 / lapSeconds(p.speed);
        let guard = 0;
        while (dt > 1e-6 && guard < 8) {
            guard++;
            const dest = mem.i + mem.dir;
            if (dest < 0 || dest >= n) { mem.dir = -mem.dir; continue; }
            const dist = Math.max(span(col(list[mem.i], 'upper'), col(list[dest], 'upper')), span(col(list[mem.i], 'lower'), col(list[dest], 'lower')), 1);
            const room = (1 - mem.u) * dist / rate;
            if (dt < room) { mem.u += (rate * dt) / dist; dt = 0; break; }
            dt -= room;
            mem.u = 0;
            mem.i = dest;
            if (mem.i + mem.dir < 0 || mem.i + mem.dir >= n) mem.dir = -mem.dir;
        }
        const dest = mem.i + mem.dir;
        const j = dest < 0 || dest >= n ? mem.i : dest;
        const up = C.lerpColor(col(list[mem.i], 'upper'), col(list[j], 'upper'), mem.u);
        const lo = C.lerpColor(col(list[mem.i], 'lower'), col(list[j], 'lower'), mem.u);
        return { upper: C.toRgb(up), lower: C.toRgb(lo), brightness: base.brightness };
    },
};
