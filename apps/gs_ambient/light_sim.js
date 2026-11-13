'use strict';
/** Simulated lighting: takes every frame and sends nothing to the car. The Farbe page shows the result. */
function create() {
    return {
        name: 'sim', label: 'Simuliert', kind: 'sim', validated: true, maxRate: 20,
        capabilities: { freeColor: true, brightness: true },
        apply: () => Promise.resolve({ ok: true }),
        release: () => Promise.resolve(),
    };
}

module.exports = { create };
