'use strict';
/**
 * Lane Runner - drive down an endless road, changing lanes with the iDrive knob (one click = one
 * lane, clockwise = down; pushing the controller up / down works too; or touch a lane on the
 * screen to steer to it), between cones and barriers, picking up fuel cans.
 * Rules: logic.js. This file draws, in the shell's look (api.style): a neon highway at night.
 */
const { Run, ROAD, LANES, LANE_H, CAR, LIVES } = require('./logic');

const W = 1600, H = 520;
const HUE = '#38d9ff';
const C = {
    road0: '#0b1122', road1: '#090d1a', verge: '#05070f', dash: [200, 225, 255, 70],
    cone: '#ff7b2e', barrier: '#ff3d5a', can: '#ffd04a', tail: '#ff2d4a', beam: [255, 244, 214],
};

class Game {
    constructor(api) {
        this.api = api;
        this.S = api.style;
        this.run = new Run(api.random);
        this.scroll = 0;       // road phase (px)
        this.countdown = 1800; // ms of "get ready" at the start (the logic keeps the road clear meanwhile)
        this.hitK = 0; this.canK = 0;
        this.fx = new this.S.Particles(260);
        this.pops = new this.S.Popups();
        this.shake = new this.S.Shake();
        this.nextMark = 100;   // the next distance milestone (m)
        this.trail = [];       // the car's recent y, for the tail-light streaks
        this.fuelShown = 1;
    }

    update(dt) {
        const r = this.run, S = this.S;
        r.step(dt);
        this.scroll += r.speed * Math.min(dt, 50) / 1000;
        this.hitK = Math.max(0, this.hitK - dt / 450);
        this.canK = Math.max(0, this.canK - dt / 500);
        this.countdown = Math.max(0, this.countdown - dt);
        this.fuelShown = S.approach(this.fuelShown, r.fuel, dt, 0.6);
        this.trail.unshift(r.y); if (this.trail.length > 10) this.trail.pop();
        r.events.forEach((e) => {
            if (e === 'hit') {
                this.hitK = 1; this.shake.kick(16);
                const o = r.things.filter((q) => q.gone && q.kind !== 'can').sort((a, b) => Math.abs(a.x - CAR.x) - Math.abs(b.x - CAR.x))[0];
                const b = o ? r.box(o) : { x: CAR.x, y: r.y, w: 0, h: 0 };
                this.fx.burst(b.x + b.w / 2, b.y + b.h / 2, o && o.kind === 'barrier' ? C.barrier : C.cone, 40, { speed: 700, life: 700, drag: 3 });
                this.fx.burst(CAR.x + CAR.w / 2, r.y, '#ffffff', 14, { speed: 500, life: 350 });
                this.pops.add(r.lives > 0 ? r.lives + ' left' : 'Crash', CAR.x + 40, r.y - 40, S.P.bad, { size: 28 });
            } else if (e === 'can') {
                this.canK = 1; this.shake.kick(4);
                this.fx.burst(CAR.x + CAR.w / 2, r.y, C.can, 28, { speed: 420, life: 650 });
                this.pops.add('Fuel', CAR.x + 60, r.y - 36, C.can, { size: 28 });
            } else if (e === 'over') { this.api.end(r.metres()); }
        });
        if (r.metres() >= this.nextMark) {
            this.pops.add(String(this.nextMark), 420, ROAD.top + 70, HUE, { size: 56, life: 1100 });
            this.nextMark += this.nextMark < 1000 ? 100 : 500;
        }
        // exhaust / speed sparks off the rear
        if (!r.over && Math.random() < r.speed / 2200) this.fx.burst(CAR.x - CAR.w / 2, r.y + (Math.random() - 0.5) * 30, HUE, 1, { dir: 180, spread: 10, speed: r.speed * 0.5, life: 260, size: 2 });
        this.fx.update(dt); this.pops.update(dt); this.shake.update(dt);
    }

    input(ev) {
        const r = this.run;
        if (r.over) return;
        if (ev.type === 'knob') r.shift(ev.delta > 0 ? 1 : ev.delta < 0 ? -1 : 0);
        else if (ev.type === 'push' && (ev.dir === 'N' || ev.dir === 'S')) r.shift(ev.dir === 'N' ? -1 : 1);
        else if (ev.type === 'touch' && ev.phase !== 'up') {
            // a finger on the road: steer to the lane under it (a drag follows the finger)
            if (ev.y < ROAD.top - 10 || ev.y > ROAD.bottom + 20) return;
            const lane = Math.max(0, Math.min(LANES - 1, Math.floor((ev.y - ROAD.top) / LANE_H)));
            r.shift(lane - r.lane);
        }
    }

    draw(cv) {
        const r = this.run, S = this.S, ox = this.shake.x, oy = this.shake.y;
        const speedK = Math.min(1, (r.speed - 520) / 980);
        this.verge(cv, ox);
        // the road: dark glass, scrolling seams, lane lines that stretch with speed
        cv.gradientRect(0, ROAD.top + oy, W, ROAD.bottom - ROAD.top, [[0, C.road0], [1, C.road1]]);
        const seam = 240, ph = this.scroll % seam;
        for (let x = -ph; x < W; x += seam) cv.fillRect(x + ox, ROAD.top + oy, 1, ROAD.bottom - ROAD.top, [120, 160, 255, 8]);
        const dashL = 50 + 60 * speedK, dp = this.scroll % 120;
        for (let i = 1; i < LANES; i++) {
            const y = ROAD.top + i * LANE_H + oy;
            for (let x = -dp; x < W; x += 120) cv.line(x + ox, y, x + dashL + ox, y, 3, C.dash);
        }
        // speed streaks over the road
        if (speedK > 0.15) {
            const n = Math.round(10 * speedK);
            for (let i = 0; i < n; i++) {
                const y = ROAD.top + 20 + ((i * 97) % (ROAD.bottom - ROAD.top - 40));
                const x = W - ((this.scroll * (1.6 + (i % 3) * 0.4) + i * 331) % (W + 400));
                cv.line(x + ox, y + oy, x + 160 + 200 * speedK + ox, y + oy, 2, [180, 220, 255, Math.round(40 * speedK)]);
            }
        }
        // neon edges
        S.glowLine(cv, 0, ROAD.top + oy, W, ROAD.top + oy, 3, HUE, 0.9);
        S.glowLine(cv, 0, ROAD.bottom + oy, W, ROAD.bottom + oy, 3, HUE, 0.9);
        // things
        r.things.forEach((o) => {
            if (o.gone) return;
            const b = r.box(o);
            if (b.x > W + 60) return;
            b.x += ox; b.y += oy;
            if (o.kind === 'cone') this.cone(cv, b);
            else if (o.kind === 'barrier') this.barrier(cv, b);
            else this.can(cv, b);
        });
        this.car(cv, r, ox, oy);
        this.fx.draw(cv, ox, oy);
        this.pops.draw(cv, ox, oy);
        S.flash(cv, 0, ROAD.top, W, ROAD.bottom - ROAD.top, S.P.bad, this.hitK);
        S.flash(cv, 0, ROAD.top, W, ROAD.bottom - ROAD.top, C.can, this.canK * 0.4);
        this.hud(cv, r);
        if (this.countdown > 0) S.countdown(cv, W / 2, (ROAD.top + ROAD.bottom) / 2 - 20, this.countdown, 600, HUE,
            'Turn the knob or touch a lane');
    }

    /** the verges: dark, with street lights passing (parallax) */
    verge(cv, ox) {
        const S = this.S;
        cv.fillRect(0, 0, W, ROAD.top, C.verge);
        cv.fillRect(0, ROAD.bottom, W, H - ROAD.bottom, C.verge);
        const sp = 320, ph = (this.scroll * 0.9) % sp;
        for (let x = -ph; x < W + sp; x += sp) {
            const lx = x + ox;
            S.halo(cv, lx, ROAD.bottom + 18, 40, '#ffb347', 1.2);
            cv.circle(lx, ROAD.bottom + 18, 4, S.a('#ffe2b0', 0.9));
        }
    }

    car(cv, r, ox, oy) {
        const S = this.S;
        const blink = r.invulnerable() && Math.floor(r.t / 110) % 2 === 0;
        const x = CAR.x - CAR.w / 2 + ox, y = r.y - CAR.h / 2 + oy, w = CAR.w, h = CAR.h;
        // headlight beams (drawn first, under everything of the car)
        [y + 9, y + h - 9].forEach((by) => S.beam(cv, x + w - 4, by, 380, 8, 110, C.beam, 0.8));
        // tail-light streaks: where the car was
        for (let i = 1; i < this.trail.length; i++) {
            const ya = this.trail[i - 1] + oy, yb = this.trail[i] + oy, xa = x - (i - 1) * 16, xb = x - i * 16, al = 0.5 * (1 - i / this.trail.length);
            cv.line(xa, ya - h / 2 + 9, xb, yb - h / 2 + 9, 4, S.a(C.tail, al));
            cv.line(xa, ya + h / 2 - 9, xb, yb + h / 2 - 9, 4, S.a(C.tail, al));
        }
        if (blink) cv.alpha(0.35);
        cv.roundRect(x + 3, y + 7, w, h, 14, [0, 0, 0, 120]);
        S.glowRect(cv, x, y, w, h, 14, HUE, 0.5);
        // body: lit from above
        cv.card(x, y, w, h, 14, [[0, '#7fe9ff'], [0.35, HUE], [1, '#0d6e92']]);
        // cabin glass and roof
        cv.card(x + 22, y + 7, w - 46, h - 14, 9, [[0, '#0e1a2e'], [1, '#050912']]);
        cv.roundRect(x + 34, y + 10, w - 72, h - 20, 6, S.a(HUE, 0.55));
        cv.fillRect(x + 36, y + 11, w - 76, 2, [255, 255, 255, 120]);
        // stripes and lights
        cv.fillRect(x + 4, y + h / 2 - 2, 16, 4, [255, 255, 255, 140]);
        cv.roundRect(x + w - 7, y + 4, 6, 10, 3, '#fff6dc'); cv.roundRect(x + w - 7, y + h - 14, 6, 10, 3, '#fff6dc');
        S.glowRect(cv, x - 1, y + 5, 4, 9, 2, C.tail, 0.8); S.glowRect(cv, x - 1, y + h - 14, 4, 9, 2, C.tail, 0.8);
        cv.roundRect(x - 1, y + 5, 4, 9, 2, C.tail); cv.roundRect(x - 1, y + h - 14, 4, 9, 2, C.tail);
        if (blink) cv.alpha(1);
    }
    cone(cv, b) {
        const S = this.S, cx = b.x + b.w / 2, base = b.y + b.h;
        S.halo(cv, cx, base - 10, 44, C.cone, 1.4);
        cv.roundRect(b.x - 3, base - 8, b.w + 6, 8, 3, S.darken(C.cone, 0.3));
        cv.quad([[cx - 4, b.y], [cx + 4, b.y], [b.x + b.w - 4, base - 6], [b.x + 4, base - 6]], C.cone);
        cv.quad([[cx - 9, b.y + 14], [cx + 9, b.y + 14], [cx + 12, b.y + 22], [cx - 12, b.y + 22]], '#fff1e0');
        cv.line(cx - 2, b.y + 4, b.x + 8, base - 10, 2, [255, 255, 255, 70]);
    }
    barrier(cv, b) {
        const S = this.S, pulse = 0.6 + 0.4 * S.ease.pulse(this.run.t, 500);
        S.glowRect(cv, b.x, b.y, b.w, b.h, 8, C.barrier, pulse);
        cv.card(b.x, b.y, b.w, b.h, 8, [[0, '#2a0d16'], [1, '#14060b']]);
        const n = Math.max(3, Math.round(b.h / 24));
        for (let i = 0; i < n; i += 2) cv.roundRect(b.x + 6, b.y + 6 + i * (b.h - 12) / n, b.w - 12, (b.h - 12) / n - 2, 3, C.barrier);
        cv.strokeRoundRect(b.x, b.y, b.w, b.h, 8, 2, S.lighten(C.barrier, 0.3));
    }
    can(cv, b) {
        const S = this.S, bob = Math.sin(this.run.t / 180) * 3, cx = b.x + b.w / 2, cy = b.y + b.h / 2 + bob;
        const ring = (this.run.t % 900) / 900;
        cv.arc(cx, cy, 26 + 18 * ring, 28 + 18 * ring, 0, 360, S.a(C.can, 0.5 * (1 - ring)));
        S.glowRect(cv, b.x, b.y + bob, b.w, b.h, 7, C.can, 0.8);
        cv.card(b.x, b.y + bob, b.w, b.h, 7, [[0, '#fff0a8'], [0.4, C.can], [1, '#b88a10']]);
        cv.roundRect(b.x + b.w - 14, b.y - 6 + bob, 10, 8, 2, C.can);
        cv.line(b.x + 9, b.y + 10 + bob, b.x + b.w - 9, b.y + b.h - 10 + bob, 4, '#6a4c00');
        cv.line(b.x + b.w - 9, b.y + 10 + bob, b.x + 9, b.y + b.h - 10 + bob, 4, '#6a4c00');
    }

    hud(cv, r) {
        const S = this.S, y = 88;
        cv.gradientRect(0, 44, W, ROAD.top - 50, [[0, [255, 255, 255, 0]], [1, [120, 170, 255, 10]]]);
        // distance (the score), big, in the game's hue
        S.stat(cv, 'Distance', r.metres(), 24, y, { unit: 'm', color: S.P.ink, size: 40 });
        const best = this.api.best();
        if (best !== null) S.stat(cv, 'Best', best, 240, y, { unit: 'm', color: S.P.dim, size: 40 });
        S.stat(cv, 'Speed', r.kmh(), 560, y, { unit: 'km/h', color: HUE, size: 40 });
        // fuel
        const low = r.fuel < 0.25, blink = low && Math.floor(r.t / 260) % 2;
        S.label(cv, 'Fuel', 860, y - 20, blink ? S.P.bad : S.P.dim, { size: 13 });
        S.meter(cv, 860, y - 10, 300, 12, this.fuelShown, low ? S.P.bad : C.can, { glow: this.canK > 0 || low });
        // lives: little lit cars
        S.label(cv, 'Cars', 1210, y - 20, S.P.dim, { size: 13 });
        for (let i = 0; i < LIVES; i++) {
            const lx = 1210 + i * 52, on = i < r.lives;
            if (on) S.block(cv, lx, y - 12, 40, 16, 6, HUE, 0.4);
            else cv.strokeRoundRect(lx, y - 12, 40, 16, 6, 1.5, S.P.faint);
        }
        this.lanes(cv, 1560, 52, r);
    }
    /** a small column of five lane pips, the target lane lit */
    lanes(cv, x, y, r) {
        const S = this.S;
        S.label(cv, 'Lane', x - 14, y + 20, S.P.dim, { size: 13, align: 'right' });
        for (let i = 0; i < LANES; i++) {
            const on = i === r.lane;
            if (on) S.block(cv, x - 6, y + i * 9, 18, 6, 3, HUE, 0.5);
            else cv.roundRect(x - 6, y + i * 9, 18, 6, 3, S.a(HUE, 0.25));
        }
    }
}

/** The menu tile's little scene: the car on a neon road between cones */
function art(cv, x, y, w, h, S, ms) {
    const mid = y + h / 2, top = mid - 46, bot = mid + 46;
    cv.fillRect(x, top, w, bot - top, '#0b1122');
    const ph = (ms * 0.12) % 60;
    for (let lx = x - ph; lx < x + w; lx += 60) cv.line(lx, mid, lx + 28, mid, 2, [200, 225, 255, 70]);
    S.glowLine(cv, x, top, x + w, top, 2, HUE, 0.8);
    S.glowLine(cv, x, bot, x + w, bot, 2, HUE, 0.8);
    const cy = mid + 22 * Math.sin(ms / 900), cx = x + w * 0.3;
    S.beam(cv, cx + 24, cy, 120, 10, 50, C.beam, 0.7);
    S.glowRect(cv, cx - 26, cy - 13, 52, 26, 8, HUE, 0.6);
    cv.card(cx - 26, cy - 13, 52, 26, 8, [[0, '#7fe9ff'], [0.4, HUE], [1, '#0d6e92']]);
    cv.roundRect(cx - 12, cy - 8, 22, 16, 4, '#0a1424');
    const kx = x + w * 0.78 - ((ms * 0.12) % (w * 0.7));
    [[kx, mid - 26], [kx + 60, mid + 24]].forEach((p) => {
        if (p[0] < x + 8 || p[0] > x + w - 8) return;
        S.halo(cv, p[0], p[1] + 6, 26, C.cone, 1.3);
        cv.quad([[p[0] - 2, p[1] - 12], [p[0] + 2, p[1] - 12], [p[0] + 9, p[1] + 10], [p[0] - 9, p[1] + 10]], C.cone);
    });
}

module.exports = {
    id: 'lane-runner',
    title: 'Lane Runner',
    blurb: 'Dodge cones lane by lane',
    order: 10,
    needs: [],
    score: { unit: 'm', lower: false },
    art,
    create(api) { return new Game(api); },
};
