'use strict';
/**
 * Route A: switch the ambient light profile over SOME/IP (the iDrive menu's 11 coded colour pairs), the
 * nearest coded pair for each frame. Locked: the field and its setter are not known yet
 * (docs/am-auto-pruefen.md, step 4). Until verified on the car it sends nothing.
 */
function create() {
    return {
        name: 'profile', label: 'Profil umschalten', kind: 'real', validated: false, maxRate: 2,
        capabilities: { freeColor: false, brightness: false },
        apply: () => Promise.resolve({ ok: false, reason: 'gesperrt' }),
        release: () => Promise.resolve(),
    };
}

module.exports = { create };
