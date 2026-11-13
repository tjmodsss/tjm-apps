'use strict';
/**
 * logic.js - Rev Keeper's rules: keep the needle inside a moving green zone with the throttle.
 * No drawing and no shell code here, so it runs under plain node (test.js).
 *
 *   const g = new RevKeeper({ random, onOver(score) });   // one round
 *   g.setInput(level)     // 0..1: throttle (the knob)
 *   g.update(dtSeconds)
 *   g.state               // 'count' (3-2-1) | 'play' | 'over'
 *
 * Rules:
 *   - The needle follows the throttle with engine-like inertia: it climbs fast and falls back slower.
 *   - The green zone moves in phases: drift, hold, jump, sweep, breathe. A jump is announced by a
 *     blinking ghost outline at the new spot first.
 *   - Inside the zone you score; staying in builds a multiplier (x1 .. x8, +1 every 2 s) and the
 *     middle third of the zone scores half again.
 *   - Outside, the engine strain rises (faster when over-revving than when bogging down, and faster
 *     the further off you are); inside it cools. Strain at 100 % blows the engine: the round ends.
 *   - Every 12 s the level rises: the zone gets narrower and moves faster.
 */

const LEVEL_SECONDS = 12;
const RISE = 12, FALL = 7;                // needle response (1/s), up and down
const MULT_MAX = 8, MULT_EVERY = 2;
const PTS_PER_S = 10;
const STRAIN_OVER = 0.42, STRAIN_UNDER = 0.30, STRAIN_COOL = 0.10, STRAIN_DIST = 1.6;
const GRACE = 0.6;                        // seconds at the start of play without strain
const COUNT_S = 2.4;                      // the 3-2-1 countdown
const DRIFT_MAX = 0.42;                 // fastest drift, scale per second
const LO = 0.12, HI = 0.94;               // the zone stays between these (a closed throttle is no target)
const PHASES = ['drift', 'hold', 'jump', 'sweep', 'breathe'];

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

/** A seeded random (mulberry32), for tests: the same seed plays the same zone pattern. */
function seeded(seed) {
    let a = (seed >>> 0) || 1;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

class RevKeeper {
    constructor(opts) {
        opts = opts || {};
        this.rand = opts.random || Math.random;
        this.onOver = opts.onOver || null;
        this.state = 'count';
        this.t = 0;                       // seconds in the current state
        this.clock = 0;                   // seconds since the round began (animations)
        this.input = 0; this.needle = 0;
        this.score = 0; this.level = 1; this.playT = 0;
        this.mult = 1; this.inT = 0; this.strain = 0;
        this.inside = false; this.centred = false;
        this.flash = 0;                   // seconds of the 'level up' banner left
        this.lost = 0;                    // seconds of the 'multiplier lost' hint left
        this.zone = { c: 0.42, w: this.width(1) };
        this.phase = null;
        this._nextPhase(true);
    }

    /** Half width of the zone at a level: from 11 % of the scale down to 5 %. */
    width(level) { return Math.max(0.05, 0.11 - 0.0075 * (level - 1)); }
    /** How fast the zone moves, x1 at level 1 up to x1.8 (beyond that the knob can't follow). */
    speed() { return Math.min(1.8, 1 + 0.08 * (this.level - 1)); }

    _nextPhase(first) {
        const r = this.rand, z = this.zone;
        let kind = first ? 'hold' : PHASES[Math.floor(r() * PHASES.length)];
        if (this.phase && kind === this.phase.kind && kind !== 'drift') kind = 'drift';
        const dur = first ? 2.5 : lerp(3, 5.5, r()) / Math.sqrt(this.speed());
        const lo = LO + z.w, hi = HI - z.w;
        const p = { kind, t: 0, dur, from: z.c };
        if (kind === 'jump') {
            // a new spot at least a quarter of the scale away, announced ahead, moved in 0.35 s
            let to, tries = 0;
            do { to = lerp(lo, hi, r()); } while (Math.abs(to - z.c) < 0.25 && ++tries < 20);
            p.to = to; p.warn = 0.9 / Math.sqrt(this.speed()); p.move = 0.35;
        } else if (kind === 'sweep') {
            p.to = z.c < 0.5 ? lerp(Math.max(lo, 0.65), hi, r()) : lerp(lo, Math.min(hi, 0.4), r());
        } else if (kind === 'drift') {
            p.a1 = lerp(0.08, 0.16, r()); p.f1 = lerp(0.25, 0.45, r()) * this.speed();
            p.a2 = lerp(0.01, 0.025, r()); p.f2 = lerp(0.8, 1.2, r());
            p.ph = r() * Math.PI * 2;
            // never faster than DRIFT_MAX (scale per second) at the peak: the knob has to follow it
            const v = 2 * Math.PI * (p.a1 * p.f1 + p.a2 * p.f2);
            if (v > DRIFT_MAX) { p.a1 *= DRIFT_MAX / v; p.a2 *= DRIFT_MAX / v; }
        } else if (kind === 'breathe') {
            p.f = lerp(0.35, 0.6, r()) * this.speed();
        }
        this.phase = p;
    }

    _moveZone(dt) {
        const z = this.zone, p = this.phase;
        p.t += dt;
        const wBase = this.width(this.level);
        z.w = lerp(z.w, wBase, Math.min(1, dt * 2));
        if (p.kind === 'drift') {
            z.c = p.from + p.a1 * (Math.sin(p.ph + p.t * p.f1 * Math.PI * 2) - Math.sin(p.ph)) +
                p.a2 * Math.sin(p.t * p.f2 * Math.PI * 2);
        } else if (p.kind === 'jump') {
            if (p.t > p.warn) z.c = lerp(p.from, p.to, ease(clamp((p.t - p.warn) / p.move, 0, 1)));
        } else if (p.kind === 'sweep') {
            z.c = lerp(p.from, p.to, ease(clamp(p.t / p.dur, 0, 1)));
        } else if (p.kind === 'breathe') {
            z.w = wBase * (1 - 0.35 * (0.5 - 0.5 * Math.cos(p.t * p.f * Math.PI * 2)));
        }
        z.c = clamp(z.c, LO + z.w, HI - z.w);
        if (p.t >= p.dur) { this.phase.from = z.c; this._nextPhase(false); }
    }

    /** The jump about to happen (for the ghost outline), or null. */
    pendingJump() {
        const p = this.phase;
        return this.state === 'play' && p && p.kind === 'jump' && p.t <= p.warn ? p : null;
    }

    setInput(v) { this.input = clamp(Number(v) || 0, 0, 1); }

    update(dt) {
        dt = clamp(dt, 0, 0.1);           // a stalled frame must not teleport the game
        this.clock += dt; this.t += dt;
        const k = this.input > this.needle ? RISE : FALL;
        this.needle += (this.input - this.needle) * Math.min(1, dt * k);
        if (this.flash > 0) this.flash -= dt;
        if (this.lost > 0) this.lost -= dt;
        if (this.state === 'count') {
            // the zone sways gently while counting down, so the screen is alive
            this.zone.c = 0.42 + 0.06 * Math.sin(this.clock * 1.2);
            if (this.t >= COUNT_S) { this.state = 'play'; this.t = 0; this.phase.from = this.zone.c; }
            return;
        }
        if (this.state !== 'play') return;

        this.playT += dt;
        const lvl = 1 + Math.floor(this.playT / LEVEL_SECONDS);
        if (lvl !== this.level) { this.level = lvl; this.flash = 1.6; }
        this._moveZone(dt);

        const z = this.zone, d = this.needle - z.c, ad = Math.abs(d);
        const wasIn = this.inside;
        this.inside = ad <= z.w;
        this.centred = ad <= z.w / 3;
        if (this.inside) {
            this.inT += dt;
            this.mult = Math.min(MULT_MAX, 1 + Math.floor(this.inT / MULT_EVERY));
            this.score += PTS_PER_S * this.mult * (this.centred ? 1.5 : 1) * dt;
            this.strain = Math.max(0, this.strain - STRAIN_COOL * dt);
        } else {
            if (wasIn && this.mult > 1) this.lost = 1.2;
            this.inT = 0; this.mult = 1;
            if (this.playT > GRACE) this.strain += ((d > 0 ? STRAIN_OVER : STRAIN_UNDER) + (ad - z.w) * STRAIN_DIST) * dt;
        }
        if (this.strain >= 1) {
            this.strain = 1;
            this.state = 'over'; this.t = 0;
            if (this.onOver) this.onOver(Math.floor(this.score));
        }
    }

    /** The engine speed shown for the needle: idle 800 to 7500 rpm (only a picture: the engine is off). */
    rpm() { return Math.round((800 + this.needle * 6700) / 10) * 10; }
}

module.exports = { RevKeeper, seeded, LEVEL_SECONDS, COUNT_S, LO, HI };
