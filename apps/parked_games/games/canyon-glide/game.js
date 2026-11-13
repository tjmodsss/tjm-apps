'use strict';
/**
 * game.js - Canyon Glide: the rules of one round (no drawing: see draw.js).
 *
 * A glider flies to the right through an endless cave. The knob (or taps) pitches it up and down;
 * holding the controller up boosts. Touching the
 * rock ends the round. Points: one per metre flown (1.5 while boosting) and 25 per crystal; crystals
 * also refill the boost. The cave gets faster, narrower and twistier the further you get.
 *
 * States: 'ready' (a short countdown, the glider waits), 'play', 'crash' (the wreck tumbles for a
 * moment), 'over' (finished: index.js hands the score to the shell).
 */
const { Cave, H, clamp, lerp, difficulty, circleHitsTri } = require('./cave');
const { Input } = require('./input');

const W = 1600;
const GX = 360;                 // glider's screen x
const R = 14;                   // glider's hit radius
const PX_PER_M = 40;
const READY_S = 2.4, CRASH_S = 1.4;
const MAX_VY = 390;             // px/s climb / dive at full pitch
const SINK = 22;                // px/s the glider sinks when level
const BOOST_SPEED = 0.85;       // speed added at full boost (fraction)
const DRAIN = 0.38, RECHARGE = 0.07, CRYSTAL_BOOST = 0.3, CRYSTAL_PTS = 25;

class Round {
    /** opts: { seed, best, invert, log } */
    constructor(opts) {
        opts = opts || {};
        this.log = opts.log;
        this.best = Number(opts.best) || 0;
        this.input = new Input({ invert: opts.invert });
        this.seed = opts.seed == null ? 1 : opts.seed;
        this.cave = new Cave(this.seed);
        this.dist = 0;              // world x of the screen's left edge
        this.y = H / 2; this.vy = 0;
        this.pitch = 0;             // drawn pitch, -1..1 (+ = nose up)
        this.energy = 1;            // boost energy 0..1
        this.boosting = 0;          // boost applied this frame 0..1
        this.points = 0; this.crystals = 0;
        this.state = 'ready'; this.t = 0; this.clock = 0;
        this.trail = [];
        this.debris = [];
        this.flash = 0;             // crystal pickup flash
        this.cave.window(0, W);
    }

    score() { return Math.floor(this.points); }
    metres() { return Math.floor(this.dist / PX_PER_M); }
    over() { return this.state === 'over'; }
    speed() { return lerp(250, 520, difficulty(this.dist)) * (1 + BOOST_SPEED * this.boosting); }

    /** one update: dt in ms (long frames are split), inp = frame input (see input.js) */
    update(dtMs, inp) {
        let dt = clamp((Number(dtMs) || 0) / 1000, 0, 0.25);
        // input once per frame (knob clicks / taps are per frame), physics in small steps
        const ctl = this.input.update(dt, inp, this.y);
        while (dt > 0) { const s = Math.min(dt, 1 / 60); this.step(s, ctl); dt -= s; }
        return this;
    }

    step(dt, ctl) {
        this.t += dt; this.clock += dt;
        this.flash = Math.max(0, this.flash - dt * 3);
        if (this.state === 'ready') {
            this.y = H / 2 + Math.sin(this.t * 3) * 6;
            if (this.t >= READY_S) { this.state = 'play'; this.t = 0; }
            return;
        }
        if (this.state === 'crash' || this.state === 'over') {
            for (const d of this.debris) { d.vy += 600 * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.a += d.va * dt; }
            if (this.state === 'crash' && this.t >= CRASH_S) {
                this.state = 'over';
                if (this.score() > this.best) this.best = this.score();
            }
            return;
        }

        // boost, limited by the energy left
        const want = this.energy > 0 ? ctl.boost : 0;
        this.boosting = want;
        if (want > 0) this.energy = Math.max(0, this.energy - DRAIN * want * dt);
        else this.energy = Math.min(1, this.energy + RECHARGE * dt);

        // flight: vertical speed eases towards what the pitch asks for
        const target = -ctl.pitch * MAX_VY + SINK * (1 - Math.abs(ctl.pitch));
        this.vy += (target - this.vy) * Math.min(1, 5.5 * dt);
        this.y += this.vy * dt;
        const sp = this.speed();
        this.pitch = clamp(-this.vy / sp, -1, 1);
        const dx = sp * dt;
        this.dist += dx;
        this.points += dx / PX_PER_M * (1 + 0.5 * this.boosting);
        this.cave.window(this.dist, this.dist + W);

        const wx = this.dist + GX;
        this.trail.push([wx, this.y]);
        if (this.trail.length > 40) this.trail.shift();

        for (const c of this.cave.crystals) {
            if (!c.taken && Math.abs(c.x - wx) < R + 18 && Math.abs(c.y - this.y) < R + 18) {
                c.taken = true; this.crystals++; this.points += CRYSTAL_PTS;
                this.energy = Math.min(1, this.energy + CRYSTAL_BOOST); this.flash = 1;
            }
        }
        if (this.hits(wx, this.y)) this.crash();
    }

    /** does the glider at world (x, y) touch rock? */
    hits(x, y) {
        // the walls under the nose, the middle and the tail
        for (let k = -1; k <= 1; k++) {
            const s = this.cave.at(x + k * R);
            if (y - R * 0.7 < s.ceil || y + R * 0.7 > s.floor) return true;
        }
        for (const p of this.cave.spires) {
            if (Math.abs(p.x - x) > p.w) continue;
            if (circleHitsTri(x, y, R * 0.8, this.cave.tri(p))) return true;
        }
        return false;
    }

    crash() {
        this.state = 'crash'; this.t = 0; this.boosting = 0;
        if (this.log) this.log.info('canyon glide: crash at ' + this.metres() + ' m, score ' + this.score());
        const r = this.cave.rand;
        this.debris = [];
        for (let i = 0; i < 9; i++) {
            this.debris.push({ x: GX, y: this.y, vx: -60 + r() * 260, vy: -260 + r() * 300, a: r() * 6, va: (r() - 0.5) * 14, s: 6 + r() * 10 });
        }
    }
}

module.exports = { Round, W, H, GX, R, PX_PER_M, READY_S, CRASH_S };
