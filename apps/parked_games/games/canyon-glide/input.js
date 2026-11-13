'use strict';
/**
 * input.js - Canyon Glide: turns the frame's input into the glider's controls.
 *
 * Frame input (index.js builds it from the knob and touch events each update):
 *   knob   integer         knob clicks this frame (+ = clockwise): each click trims the glider's
 *                          pitch, and the trim stays until you turn back or press
 *   level  bool            the knob was pressed this frame: level out (trim back to 0)
 *   boost  0..1            the controller held up (N): boost while held
 *   tap    {x, y} or null  a tap on the game (1600 x 520 px): a nudge up / down that fades
 *   hold   y or null       a finger held on the cave (screen y): the glider climbs or dives towards it
 *   steer  -1..1 or null   an absolute stick, for the autopilots in the tests and media only
 *
 * Out: pitch -1..1 (+1 = climb hard, -1 = dive hard) and boost 0..1 (wanted; the game limits it
 * by the boost energy left).
 *
 * The glider flies to the right, so turning the knob clockwise tips its nose down (dive) and
 * anticlockwise lifts it (climb), like a wheel would. Setting `invert` swaps that.
 */
const { clamp } = require('./cave');

const KNOB_STEP = 0.12;         // pitch trim per knob click
const NUDGE_FADE = 1.6;         // tap nudge fades at this much pitch per second
const TAP_NUDGE = 0.8;
const HOLD_SPAN = 140;          // a finger this far above / below the glider = full climb / dive

class Input {
    constructor(opts) {
        this.invert = !!(opts && opts.invert);
        this.trim = 0;              // knob pitch, held
        this.nudge = 0;             // tap pitch, fading to 0
        this.source = 'knob';       // what steered last: 'knob' | 'touch'
    }

    reset() { this.trim = 0; this.nudge = 0; }

    /** dt in s; inp as above; gliderY = the glider's screen y (for taps). Returns { pitch, boost } */
    update(dt, inp, gliderY) {
        inp = inp || {};
        const sign = this.invert ? -1 : 1;
        if (inp.level) this.trim = 0;
        if (inp.knob) { this.trim = clamp(this.trim - sign * inp.knob * KNOB_STEP, -1, 1); this.source = 'knob'; }
        if (inp.tap && typeof inp.tap.y === 'number') {
            this.nudge = clamp(this.nudge + (inp.tap.y < gliderY ? TAP_NUDGE : -TAP_NUDGE), -1, 1);
            this.source = 'touch';
        }
        let hold = 0;
        if (typeof inp.hold === 'number' && isFinite(inp.hold) && typeof gliderY === 'number') {
            hold = clamp((gliderY - inp.hold) / HOLD_SPAN, -1, 1);
            this.trim = 0;          // the finger takes over; the knob trim starts again from level
            this.source = 'touch';
        }
        const f = NUDGE_FADE * dt;
        this.nudge = Math.abs(this.nudge) <= f ? 0 : this.nudge - Math.sign(this.nudge) * f;
        const stick = typeof inp.steer === 'number' && isFinite(inp.steer) ? -sign * clamp(inp.steer, -1, 1) : 0;
        const pitch = clamp(stick + this.trim + this.nudge + hold, -1, 1);
        const boost = typeof inp.boost === 'number' && isFinite(inp.boost) ? clamp(inp.boost, 0, 1) : inp.boost ? 1 : 0;
        return { pitch: pitch, boost: boost };
    }
}

module.exports = { Input, KNOB_STEP, HOLD_SPAN };
