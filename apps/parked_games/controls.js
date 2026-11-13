'use strict';
/**
 * controls.js - the iDrive controller's raw state -> game input events (GAMES.md).
 *
 *   const c = new Controller();
 *   c.feed(v) -> [{ type: 'knob', delta }, { type: 'press' }, { type: 'hold' }, { type: 'push', dir }, { type: 'release' }]
 *
 * 'hold': the knob is still pressed after a long press (the shell's pause, not a game's input).
 *
 * v is FrontCCU.statusRotaryEncoderState (or the same fields from ctx.controller.onInput):
 * frontRotaryEncoderOperation = knob counter (16 bit, wraps), frontRotaryEncoderPushButton = press,
 * frontRotaryEncoderDeflection = push N / E / S / W. Enums come by name or as numbers.
 */
const DEFL = { MITTELSTELLUNG: 0, NORD_KURZ_GEDRUECKT: 1, NORD_LANG_GEDRUECKT: 2, NORD_UNWIRKSAM: 3, OST_KURZ_GEDRUECKT: 4,
    OST_LANG_GEDRUECKT: 5, OST_UNWIRKSAM: 6, SUED_KURZ_GEDRUECKT: 7, SUED_LANG_GEDRUECKT: 8, SUED_UNWIRKSAM: 9,
    WEST_KURZ_GEDRUECKT: 10, WEST_LANG_GEDRUECKT: 11, WEST_UNWIRKSAM: 12, SIGNAL_UNGUELTIG: 15 };
const PUSH = { KEINE_BETAETIGUNG: 0, DREHGEBER_KURZ_GEDRUECKT: 1, DREHGEBER_LANG_GEDRUECKT: 2, UNWIRKSAM: 3, SIGNAL_UNGUELTIG: 15 };
const DIR = { 1: 'N', 2: 'N', 4: 'E', 5: 'E', 7: 'S', 8: 'S', 10: 'W', 11: 'W' };
const num = (v, names) => (typeof v === 'number' ? v : v != null && names[v] != null ? names[v] : 15);

class Controller {
    constructor() { this.pos = null; this.pressed = false; this.long = false; this.dir = null; }
    feed(v) {
        const out = [];
        if (!v) return out;
        const pb = num(v.frontRotaryEncoderPushButton, PUSH), df = num(v.frontRotaryEncoderDeflection, DEFL), pos = v.frontRotaryEncoderOperation;
        if (pb === 15 && df === 15) return out;                // no controller behind it (a VM)
        if (typeof pos === 'number' && pos !== 65535) {
            if (this.pos !== null) {
                const d = ((pos - this.pos + 32768) & 0xffff) - 32768;
                if (d && Math.abs(d) <= 64) out.push({ type: 'knob', delta: d });
            }
            this.pos = pos;
        }
        const down = pb === 1 || pb === 2;
        if (down && !this.pressed) out.push({ type: 'press' });
        if (pb === 2 && !this.long) out.push({ type: 'hold' });
        this.pressed = down; this.long = pb === 2;
        const dir = DIR[df] || null;
        if (dir !== this.dir) {
            if (dir) out.push({ type: 'push', dir });
            else if (df === 0) out.push({ type: 'release' });
            if (dir || df === 0) this.dir = dir;
        }
        return out;
    }
    /** Is the controller pushed this way right now? */
    held(dir) { return this.dir === dir; }
}

module.exports = { Controller };
