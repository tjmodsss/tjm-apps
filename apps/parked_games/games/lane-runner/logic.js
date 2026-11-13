'use strict';
/**
 * Lane Runner's rules, without drawing (testable with plain node).
 *
 * A road runs left to right across the screen, five lanes stacked top to bottom. The car stays near
 * the left edge and changes lane on the iDrive knob: each click moves it one lane (clockwise =
 * towards the bottom, the car's right side). Rows of cones and barriers come towards it, always with a way
 * through; fuel cans refill the tank, which slowly empties. Three hits or an empty tank end the run.
 * The road gets faster all the time. Score: metres driven.
 */
const ROAD = { top: 96, bottom: 486 };                    // screen px (the HUD above, kept below the HMI's status strip)
const LANES = 5;
const LANE_H = (ROAD.bottom - ROAD.top) / LANES;          // 78
const CAR = { x: 200, w: 96, h: 46 };
const PX_PER_M = 10;
const SPEED0 = 520, SPEED_MAX = 1500, SPEED_RAMP = 3.2;    // px/s, +px/s every second
const FUEL_S = 40;                                         // seconds of fuel in a full tank
const CAN_FUEL = 0.35;                                     // a can refills this much of the tank
const LIVES = 3, HIT_GRACE_MS = 1200, START_CLEAR_MS = 1800;

const laneY = (i) => ROAD.top + LANE_H * (i + 0.5);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

class Run {
    /** rng: () => 0..1 */
    constructor(rng) {
        this.rng = rng || Math.random;
        this.t = 0;                         // ms since the start
        this.dist = 0;                      // px driven
        this.speed = SPEED0;
        this.y = laneY(2);                  // car centre
        this.target = this.y;
        this.lane = 2;                      // the lane the car is heading for (the knob moves it)
        this.fuel = 1;
        this.lives = LIVES;
        this.hitT = -1e9;
        this.things = [];                   // { kind: 'cone'|'barrier'|'can', x, lane, lanes, w, h }
        this.nextRowAt = 0;                 // dist at which the next row spawns
        this.free = 2;                      // the lane kept open by the last row
        this.over = false;
        this.why = null;                    // 'crash' | 'fuel'
        this.cans = 0; this.dodged = 0;
        this.events = [];                   // 'hit', 'can', 'over' since the last step (sounds / flashes)
    }
    metres() { return Math.floor(this.dist / PX_PER_M); }
    kmh() { return Math.round(this.speed / PX_PER_M * 3.6); }
    /** The middle of a lane (screen y), 0 = top; out of range = the nearest edge lane. */
    static yFor(lane) { return laneY(clamp(Math.round(typeof lane === 'number' && isFinite(lane) ? lane : 2), 0, LANES - 1)); }
    /** Change lane by n (+ = down, the knob turned clockwise); returns the new lane. */
    shift(n) { this.lane = clamp(this.lane + Math.round(n || 0), 0, LANES - 1); return this.lane; }
    invulnerable() { return this.t - this.hitT < HIT_GRACE_MS; }

    step(dtMs, lane) {
        if (typeof lane === 'number') this.lane = clamp(Math.round(lane), 0, LANES - 1);
        this.events = [];
        if (this.over) return;
        const dt = clamp(dtMs, 0, 50) / 1000;
        this.t += dtMs;
        this.speed = Math.min(SPEED_MAX, this.speed + SPEED_RAMP * dt * 10 * (this.speed < 900 ? 1 : 0.6));
        const dx = this.speed * dt;
        this.dist += dx;
        // the car glides to its lane quickly but not instantly (a real car doesn't jump)
        this.target = Run.yFor(this.lane);
        const k = 1 - Math.exp(-dt * 12);
        this.y += (this.target - this.y) * k;
        // fuel
        this.fuel = Math.max(0, this.fuel - dt / FUEL_S);
        // things move towards the car
        this.things.forEach((o) => { o.x -= dx; });
        const before = this.things.length;
        this.things = this.things.filter((o) => o.x + o.w > -40);
        this.dodged += before - this.things.length;
        // spawn rows
        if (this.t > START_CLEAR_MS && this.dist >= this.nextRowAt) this.spawn();
        this.collide();
        if (this.fuel <= 0) this.end('fuel');
    }

    spawn() {
        const r = this.rng;
        // the open lane moves by at most one or two lanes from the last one, so there is always time to reach it
        const reach = this.speed > 1000 ? 1 : 2;
        const free = clamp(this.free + Math.round((r() * 2 - 1) * reach), 0, LANES - 1);
        this.free = free;
        const x = 1700;
        const blocked = [];
        for (let i = 0; i < LANES; i++) if (i !== free && r() < 0.55) blocked.push(i);
        if (!blocked.length) blocked.push(free === 0 ? 1 : free - 1);
        // two blocked lanes next to each other sometimes become one barrier
        for (let n = 0; n < blocked.length; n++) {
            const i = blocked[n];
            if (blocked[n + 1] === i + 1 && r() < 0.4) {
                this.things.push({ kind: 'barrier', x, lane: i, lanes: 2, w: 34, h: LANE_H * 2 - 18 });
                n++;
            } else this.things.push({ kind: 'cone', x: x + (r() * 60 - 30), lane: i, lanes: 1, w: 40, h: 44 });
        }
        // a fuel can in the open lane, more often when the tank is low
        if (r() < (this.fuel < 0.4 ? 0.45 : 0.18)) this.things.push({ kind: 'can', x: x + 30, lane: free, lanes: 1, w: 34, h: 40 });
        // rows come closer together as the road gets faster, but never closer in time than ~0.55 s
        const gap = Math.max(this.speed * 0.55, 620 - this.t / 1000 * 2);
        this.nextRowAt = this.dist + gap + r() * 160;
    }

    /** The car's box and a thing's box (screen px). */
    carBox() { return { x: CAR.x - CAR.w / 2, y: this.y - CAR.h / 2, w: CAR.w, h: CAR.h }; }
    box(o) {
        const cy = ROAD.top + LANE_H * (o.lane + o.lanes / 2);
        return { x: o.x - o.w / 2, y: cy - o.h / 2, w: o.w, h: o.h };
    }

    collide() {
        const c = this.carBox();
        // a little forgiving: the visible corners are rounded
        const hit = (b, m) => c.x + m < b.x + b.w && b.x < c.x + c.w - m && c.y + m < b.y + b.h && b.y < c.y + c.h - m;
        for (const o of this.things) {
            if (o.gone) continue;
            if (o.kind === 'can') {
                if (hit(this.box(o), 0)) { o.gone = true; this.fuel = Math.min(1, this.fuel + CAN_FUEL); this.cans++; this.events.push('can'); }
            } else if (!this.invulnerable() && hit(this.box(o), 6)) {
                o.gone = true; this.lives--; this.hitT = this.t; this.events.push('hit');
                this.speed = Math.max(SPEED0, this.speed * 0.8);
                if (this.lives <= 0) { this.end('crash'); return; }
            }
        }
        this.things = this.things.filter((o) => !(o.gone && o.kind === 'can'));
    }

    end(why) { if (!this.over) { this.over = true; this.why = why; this.events.push('over'); } }
}

module.exports = { Run, ROAD, LANES, LANE_H, CAR, PX_PER_M, LIVES, laneY };
