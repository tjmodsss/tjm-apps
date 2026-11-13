'use strict';
/**
 * Canyon Glide - fly a glider through an endless cave with the iDrive knob: turn it to climb and
 * dive (clockwise tips the nose down, as the glider flies to the right; the trim stays where you
 * leave it), press to level out, hold the controller up to boost. On the touchscreen: hold a
 * finger above or below the glider to climb or dive towards it (taps nudge it), and hold the
 * Boost meter (top right) to boost. One touch of the rock ends the round.
 *
 * Files: cave.js (the cave), input.js (controls), game.js (rules), draw.js (drawing),
 * autopilot.js (flies by itself: the tests use it), test.js.
 * Interface: apps/parked_games/GAMES.md.
 */
const { Round } = require('./game');
const { draw } = require('./draw');
const look = require('./look');

const HOW = { steer: 'Turn the knob, or hold a finger above / below the glider', boost: 'hold the controller up, or touch here' };
// the Boost meter in the HUD (look.js / draw.js draw it top right): a finger held on it boosts
const BOOST_BOX = { x: 1600 - 24 - 280 - 30, y: 44, w: 280 + 54, h: 90 };
const inBox = (b, x, y) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h;

class Game {
    constructor(api) {
        this.api = api;
        const best = api.best && api.best();
        const store = api.store;
        this.round = new Round({
            seed: Math.floor(api.random() * 0x7fffffff) + 1,
            best: best == null ? 0 : best,
            invert: !!(store && store.get('invert')),
            log: api.log,
        });
        this.knob = 0; this.level = false; this.tap = null; this.boost = false;
        this.hold = null;           // a finger held on the cave: its y
        this.touchBoost = false;    // a finger held on the Boost meter
        this.ended = false;
        this.fx = api.style ? new look.Fx(api.style) : null;
    }

    input(ev) {
        if (!ev) return;
        if (ev.type === 'knob') this.knob += Number(ev.delta) || 0;
        else if (ev.type === 'press') this.level = true;
        else if (ev.type === 'push') this.boost = ev.dir === 'N';
        else if (ev.type === 'release') this.boost = false;
        else if (ev.type === 'tap') { if (!inBox(BOOST_BOX, ev.x, ev.y)) this.tap = { x: ev.x, y: ev.y }; }
        else if (ev.type === 'touch') {
            if (ev.phase === 'up') { this.hold = null; this.touchBoost = false; return; }
            if (ev.phase === 'down') this.touchBoost = inBox(BOOST_BOX, ev.x, ev.y);
            if (!this.touchBoost) this.hold = ev.y;
        }
    }

    frame() {
        const inp = { knob: this.knob, level: this.level, boost: this.boost || this.touchBoost ? 1 : 0, tap: this.tap, hold: this.hold };
        this.knob = 0; this.level = false; this.tap = null;
        return inp;
    }

    update(dtMs) {
        if (this.ended) return;
        this.round.update(dtMs, this.frame());
        if (this.fx) this.fx.update(dtMs, this.round);
        if (this.round.over()) { this.ended = true; this.api.end(this.round.score()); }
    }

    pause() { this.boost = false; this.hold = null; this.touchBoost = false; }

    hints() { return HOW; }

    draw(cv) {
        if (this.fx) look.draw(cv, this.round, this.api.style, this.fx, this.hints());
        else draw(cv, this.round, this.api.theme && this.api.theme(), this.hints());
    }
}

module.exports = {
    id: 'canyon-glide',
    title: 'Canyon Glide',
    blurb: 'Glide the endless cave',
    order: 30,
    needs: [],
    score: { unit: 'pts', lower: false },
    art: look.art,
    create(api) { return new Game(api); },
};
