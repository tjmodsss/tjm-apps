'use strict';
/** Überblenden: holds each of the first 2 or 3 favourites, then blends smoothly into the next. */
const C = require('./color');

module.exports = {
    id: 'fade',
    name: 'Überblenden',
    needs: [],
    swatch: [[255, 48, 48], [32, 80, 255]],
    params: [
        { key: 'count', label: 'Anzahl', type: 'choice', options: [[2, '2'], [3, '3']], default: 2 },
        { key: 'hold', label: 'Halten', type: 'range', min: 1, max: 30, step: 1, default: 5, unit: 's' },
        { key: 'trans', label: 'Übergang', type: 'range', min: 1, max: 10, step: 1, default: 2, unit: 's' },
    ],
    usesBase: () => false,
    available: (base) => (base.favs.length >= 2 ? null : 'Mindestens 2 Favoriten nötig'),
    run(t, inputs, p, base) {
        const list = base.favs.slice(0, Math.min(p.count, base.favs.length));
        const seg = p.hold + p.trans, n = list.length, tau = t % (n * seg);
        const i = Math.floor(tau / seg), w = tau - i * seg;
        const a = list[i], b = list[(i + 1) % n];
        const f = w < p.hold ? 0 : (w - p.hold) / p.trans, k = f * f * (3 - 2 * f);
        return { upper: C.mixRgb(a.upper, b.upper, k), lower: C.mixRgb(a.lower, b.lower, k), brightness: base.brightness };
    },
};
