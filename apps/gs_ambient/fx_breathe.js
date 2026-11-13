'use strict';
/**
 * Atmen: the brightness swells down and up again (cosine), the colours stay.
 * The car takes about two updates a second, so a swell shorter than 15 seconds looks like steps.
 */
module.exports = {
    id: 'breathe',
    name: 'Atmen',
    needs: [],
    swatch: [[255, 255, 255], [40, 40, 40]],
    params: [
        { key: 'period', label: 'Dauer', type: 'range', min: 15, max: 90, step: 5, default: 30, unit: 's' },
        { key: 'depth', label: 'Tiefe', type: 'range', min: 10, max: 80, step: 10, default: 50, unit: '%' },
    ],
    usesBase: () => true,
    run(t, inputs, p, base) {
        const period = p.period < 15 ? 15 : p.period;
        const k = 0.5 - 0.5 * Math.cos(2 * Math.PI * t / period);
        return { upper: base.upper, lower: base.lower, brightness: base.brightness * (1 - (p.depth / 100) * k) };
    },
};
