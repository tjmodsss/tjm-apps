'use strict';
/**
 * Rev Keeper - a Parked Games game (interface: apps/parked_games/GAMES.md).
 *
 * Keep the needle inside a green zone that keeps moving, on a throttle you work with the iDrive
 * knob: each click clockwise opens it by 4 %, anticlockwise closes it; pushing the controller up
 * or down moves it a fifth of the scale at once (for the jumps). It stays where you leave it.
 * On the touchscreen the rev strip is a slider: touch or drag along it to set the throttle there.
 *
 * Rules: logic.js. Picture: draw.js. Tests: node apps/parked_games/games/rev-keeper/test.js
 */
const { RevKeeper } = require('./logic');
const { draw } = require('./draw');
const look = require('./look');

const KNOB_STEP = 0.04, PUSH_STEP = 0.2;
// the rev strip's ends on screen (look.js: X0 = 80, X1 = 1520): a finger there = 0 % / 100 % throttle
const STRIP_X0 = 80, STRIP_X1 = 1520, TOUCH_TOP = 140;
const clamp01 = (x) => Math.max(0, Math.min(1, x));

class Game {
    constructor(api) {
        this.api = api;
        this.paused = false;
        this.throttle = 0;                // 0..1, set by the knob
        this.ended = false;
        this.g = new RevKeeper({
            random: api.random,
            onOver: (score) => { if (!this.ended) { this.ended = true; api.end(score); } },
        });
        this.fx = api.style ? new look.Fx(api.style) : null;
    }

    update(dtMs) {
        this.g.setInput(this.throttle);
        this.g.update(dtMs / 1000);
        if (this.fx) this.fx.update(dtMs, this.g);
    }

    draw(cv) {
        const best = this.api.best();
        const view = { best: best == null ? null : best, source: this.source || 'knob', paused: this.paused, throttle: this.throttle };
        if (this.fx) look.draw(cv, this.g, this.api.style, this.fx, view);
        else draw(cv, this.g, view);
    }

    input(ev) {
        if (this.paused || this.g.state === 'over') return;
        if (ev.type === 'knob') { this.throttle = clamp01(this.throttle + ev.delta * KNOB_STEP); this.source = 'knob'; }
        else if (ev.type === 'push' && (ev.dir === 'N' || ev.dir === 'S')) {
            this.throttle = clamp01(this.throttle + (ev.dir === 'N' ? PUSH_STEP : -PUSH_STEP));
            this.source = 'knob';
        } else if (ev.type === 'touch' && ev.phase !== 'up' && ev.y >= TOUCH_TOP) {
            // anywhere below the score: the finger's x along the strip is the throttle
            this.throttle = clamp01((ev.x - STRIP_X0) / (STRIP_X1 - STRIP_X0));
            this.source = 'touch';
        }
    }
    pause() { this.paused = true; }
    resume() { this.paused = false; }
}

module.exports = {
    id: 'rev-keeper',
    title: 'Rev Keeper',
    blurb: 'Rev into the moving green',
    order: 40,
    needs: [],
    score: { unit: 'pts', lower: false },
    art: look.art,
    create(api) { return new Game(api); },
};
