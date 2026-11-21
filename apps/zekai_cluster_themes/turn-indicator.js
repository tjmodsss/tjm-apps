'use strict';

const BLINK_PERIOD_MS = 640;
const STALK_DIRECTIONS = {
    1: 'left', 3: 'left', TIPP_BLINKEN_LINKS_EIN: 'left', DAUER_BLINKEN_LINKS_EIN: 'left',
    2: 'right', 4: 'right', TIPP_BLINKEN_RECHTS_EIN: 'right', DAUER_BLINKEN_RECHTS_EIN: 'right',
    8: 'both', BEIDSEITIGES_BLINKEN_EIN: 'both',
};
const ACTIVE_DIRECTIONS = {
    7: 'left', 9: 'left', DAUERBLINKEN_LINKS: 'left', TIPPBLINKEN_LINKS: 'left',
    8: 'right', 10: 'right', DAUERBLINKEN_RECHTS: 'right', TIPPBLINKEN_RECHTS: 'right',
    6: 'both', WARNBLINKEN_MANUELL: 'both',
};

function fields(value, key) {
    if (!value || typeof value !== 'object') return null;
    if (Object.prototype.hasOwnProperty.call(value, key)) return value;
    for (const nested of Object.values(value)) {
        const found = fields(nested, key);
        if (found) return found;
    }
    return null;
}

function knownDirection(table, value) {
    return Object.prototype.hasOwnProperty.call(table, value) ? table[value] : null;
}

class TurnIndicator {
    constructor(now) {
        this.now = now;
        this.reset();
    }

    reset() {
        this.direction = 'off';
        this.startedAt = 0;
    }

    set(direction) {
        if (direction !== this.direction) this.startedAt = this.now();
        this.direction = direction;
    }

    lightFunction(value) {
        const status = fields(value, 'controlIndicateDirection') || fields(value, 'activeFunctionIndicateDirection');
        if (!status) return;
        const control = status.controlIndicateDirection;
        const active = status.activeFunctionIndicateDirection;
        const direction = knownDirection(STALK_DIRECTIONS, control) || knownDirection(ACTIVE_DIRECTIONS, active);
        if (direction) this.set(direction);
        else if (control === 0 || control === 'BLINKEN_AUS' || active === 0 || active === 'BLINKEN_AUS') {
            this.set('off');
        }
    }

    lit(now) {
        const elapsed = now - this.startedAt;
        return this.direction !== 'off' && elapsed >= 0 && elapsed % BLINK_PERIOD_MS < BLINK_PERIOD_MS / 2;
    }
}

module.exports = { TurnIndicator };
