'use strict';
/**
 * engine.js - Brick Breaker's rules and physics, with no drawing and no head unit in it (so it
 * runs the same in the car, the emulator and the tests).
 *
 * Played sideways for the wide screen: the paddle slides up and down the left edge, the ball
 * flies right into a wall of bricks and back. Coordinates are field px: x 0..FW (left to
 * right), y 0..FH (top to bottom).
 *
 *   const g = new Engine({ seed: 1 });
 *   g.move(+2)          knob clicks (+ = clockwise = paddle down)
 *   g.aim(y)            paddle to field y (touch)
 *   g.action()          launch / next level / play again
 *   g.step(ms)          advance time
 */
const { LEVELS, ROWS, COLS } = require('./levels');

const FW = 1600, FH = 420;
const PADDLE_X = 56, PADDLE_T = 18, PADDLE_H = 116, PADDLE_WIDE = 180;
const BALL_R = 10;
const BRICK_W = 62, BRICK_GAP = 4, BRICK_RIGHT = 24;
const BRICK_H = (FH - BRICK_GAP) / ROWS;
const BRICK_X0 = FW - BRICK_RIGHT - COLS * (BRICK_W + BRICK_GAP);
const KNOB_STEP = 34;             // paddle px per knob click
const PUSH_STEP = 110;            // paddle px per controller push up / down
const BASE_SPEED = 820;           // ball px/s on level 1
const LEVEL_SPEED = 30;           // + px/s per level
const MAX_SPEED = 1200;
const MAX_ANGLE = 60 * Math.PI / 180, MIN_ANGLE = 7 * Math.PI / 180;
const DROP_SPEED = 280;
const DROP_CHANCE = 0.15;
const WIDE_MS = 15000, SLOW_MS = 10000, SLOW = 0.7;
const MAX_LIVES = 5, START_LIVES = 3;
const BANNER_MS = 2200;
const POWERS = ['wide', 'multi', 'slow', 'life'];

/** small seeded random (mulberry32): same seed, same game */
function rng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

class Engine {
    constructor(opts) {
        opts = opts || {};
        this.rand = rng(opts.seed != null ? opts.seed : Date.now());
        this.events = [];                 // what happened since the last read (sounds / effects): { type, ... }
        this.reset();
    }

    /** a new game from level 1 */
    reset() {
        this.score = 0;
        this.lives = START_LIVES;
        this.level = 0;                   // 0-based, keeps counting past the last layout (they repeat, faster)
        this.over = false;
        this.loadLevel();
    }

    loadLevel() {
        const L = LEVELS[this.level % LEVELS.length];
        this.levelName = L.name;
        this.bricks = [];
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                const ch = L.map[r][c];
                if (ch === '.' || ch == null) continue;
                const steel = ch === '#', bonus = ch === '*';
                const hp = steel ? Infinity : bonus ? 1 : Number(ch);
                this.bricks.push({
                    r, c, steel, bonus, hp, max: hp, flash: 0,
                    x: BRICK_X0 + c * (BRICK_W + BRICK_GAP) + BRICK_GAP, y: BRICK_GAP + r * BRICK_H,
                    w: BRICK_W, h: BRICK_H - BRICK_GAP,
                });
            }
        }
        this.drops = [];
        this.wideMs = 0; this.slowMs = 0;
        this.paddle = { y: FH / 2, target: FH / 2, h: PADDLE_H };
        this.streak = 0;
        this.hits = 0;                    // paddle hits this ball (the ball speeds up a little each)
        this.banner = BANNER_MS;          // "Level n" shown at the start
        this.serve();
    }

    /** a ball waiting on the paddle */
    serve() {
        this.balls = [{ x: 0, y: 0, vx: 0, vy: 0, stuck: true, off: (this.rand() - 0.5) * 40 }];
        this.hits = 0;
        this.state = 'serve';
        this.stickBalls();
    }

    remaining() { let n = 0; for (const b of this.bricks) if (!b.steel) n++; return n; }

    speed() {
        const base = Math.min(MAX_SPEED, BASE_SPEED + LEVEL_SPEED * this.level);
        return Math.min(MAX_SPEED, base * (1 + 0.015 * Math.min(this.hits, 20))) * (this.slowMs > 0 ? SLOW : 1);
    }

    /* ---------- input ---------- */
    /** knob clicks: + = clockwise = paddle down (as the knob scrolls a list down) */
    move(clicks) { this.aim(this.paddle.target + clicks * KNOB_STEP); }
    /** controller pushed up (N) or down (S) */
    nudge(dir) { this.aim(this.paddle.target + (dir === 'S' ? PUSH_STEP : -PUSH_STEP)); }
    /** paddle to field y (finger, or tap) */
    aim(y) {
        if (this.over) return;
        const h = this.paddle.h;
        this.paddle.target = clamp(y, h / 2, FH - h / 2);
    }
    /** press / tap: launch the ball, skip the level banner, or start over after game over */
    action() {
        if (this.over) { this.reset(); this.events.push({ type: 'restart' }); return; }
        if (this.banner > 0) this.banner = 0;
        if (this.state === 'serve') this.launch();
    }

    launch() {
        const s = this.speed();
        for (const b of this.balls) {
            if (!b.stuck) continue;
            const rel = clamp(b.off / (this.paddle.h / 2), -1, 1);
            const a = rel * MAX_ANGLE * 0.6 + (this.rand() - 0.5) * 0.2;
            b.vx = Math.cos(a) * s; b.vy = Math.sin(a) * s; b.stuck = false;
        }
        this.state = 'play';
        this.events.push({ type: 'launch' });
    }

    /* ---------- time ---------- */
    step(ms) {
        if (this.over) return;
        ms = Math.min(ms, 100);           // a long stall (popup, GC) doesn't teleport the ball
        if (this.banner > 0) this.banner = Math.max(0, this.banner - ms);
        for (const b of this.bricks) if (b.flash > 0) b.flash = Math.max(0, b.flash - ms);
        this.stepPaddle(ms);
        if (this.wideMs > 0) { this.wideMs -= ms; if (this.wideMs <= 0) { this.wideMs = 0; this.setPaddleH(PADDLE_H); } }
        if (this.slowMs > 0) { this.slowMs -= ms; if (this.slowMs <= 0) { this.slowMs = 0; this.rescale(); } }
        if (this.state === 'serve') { this.stickBalls(); this.stepDrops(ms); return; }
        if (this.state !== 'play') return;
        // sub-steps: the ball never moves more than a third of its radius at a time
        const far = Math.max.apply(null, this.balls.map((b) => Math.hypot(b.vx, b.vy) * ms / 1000));
        const n = Math.max(1, Math.ceil(far / (BALL_R / 3)));
        for (let i = 0; i < n && this.state === 'play'; i++) this.stepBalls(ms / 1000 / n);
        this.stepDrops(ms);
    }

    stepPaddle(ms) {
        const p = this.paddle;
        const k = 1 - Math.exp(-ms / 45);     // glide to the target (about 45 ms time constant)
        p.y += (p.target - p.y) * k;
        if (Math.abs(p.target - p.y) < 0.5) p.y = p.target;
    }

    stickBalls() {
        const p = this.paddle;
        for (const b of this.balls) if (b.stuck) {
            b.x = PADDLE_X + PADDLE_T + BALL_R + 1;
            b.y = clamp(p.y + b.off, BALL_R, FH - BALL_R);
        }
    }

    setPaddleH(h) {
        const p = this.paddle;
        p.h = h;
        p.target = clamp(p.target, h / 2, FH - h / 2);
        p.y = clamp(p.y, h / 2, FH - h / 2);
    }

    /** ball speeds follow speed() (slow-motion on / off, paddle hits) */
    rescale() {
        const s = this.speed();
        for (const b of this.balls) {
            if (b.stuck) continue;
            const v = Math.hypot(b.vx, b.vy) || 1;
            b.vx *= s / v; b.vy *= s / v;
        }
    }

    stepBalls(dt) {
        const p = this.paddle;
        for (const b of this.balls) {
            if (b.stuck) continue;
            b.x += b.vx * dt; b.y += b.vy * dt;
            // walls: top, bottom, back
            if (b.y < BALL_R) { b.y = BALL_R; b.vy = Math.abs(b.vy); this.events.push({ type: 'wall' }); }
            if (b.y > FH - BALL_R) { b.y = FH - BALL_R; b.vy = -Math.abs(b.vy); this.events.push({ type: 'wall' }); }
            if (b.x > FW - BALL_R) { b.x = FW - BALL_R; b.vx = -Math.abs(b.vx); this.events.push({ type: 'wall' }); }
            // paddle (only on the way towards it)
            if (b.vx < 0 && b.x - BALL_R <= PADDLE_X + PADDLE_T && b.x + BALL_R >= PADDLE_X &&
                b.y + BALL_R >= p.y - p.h / 2 && b.y - BALL_R <= p.y + p.h / 2) {
                this.hits++;
                const rel = clamp((b.y - p.y) / (p.h / 2), -1, 1);
                // never dead straight back (it would rattle along one row forever): at least ~7 degrees
                let a = rel * MAX_ANGLE;
                if (Math.abs(a) < MIN_ANGLE) a = (a < 0 || (a === 0 && b.vy < 0) ? -1 : 1) * MIN_ANGLE;
                const s = this.speed();
                b.vx = Math.cos(a) * s; b.vy = Math.sin(a) * s;
                b.x = PADDLE_X + PADDLE_T + BALL_R;
                this.streak = 0;
                this.events.push({ type: 'paddle' });
            }
            this.hitBrick(b);
            if (b.x < -BALL_R * 2) b.lost = true;
        }
        if (this.balls.some((b) => b.lost)) {
            this.balls = this.balls.filter((b) => !b.lost);
            if (!this.balls.length) this.loseLife();
        }
    }

    /** the first brick the ball touches: bounce off the side it came in through */
    hitBrick(b) {
        for (const k of this.bricks) {
            const cx = clamp(b.x, k.x, k.x + k.w), cy = clamp(b.y, k.y, k.y + k.h);
            const dx = b.x - cx, dy = b.y - cy;
            if (dx * dx + dy * dy > BALL_R * BALL_R) continue;
            // how far the ball reaches into the brick along each axis: the smaller one is the side hit
            const px = b.vx > 0 ? b.x + BALL_R - k.x : k.x + k.w - (b.x - BALL_R);
            const py = b.vy > 0 ? b.y + BALL_R - k.y : k.y + k.h - (b.y - BALL_R);
            if (px < py) { b.vx = -b.vx; b.x += b.vx > 0 ? px : -px; } else { b.vy = -b.vy; b.y += b.vy > 0 ? py : -py; }
            this.keepAngle(b);
            this.damage(k);
            return;
        }
    }

    /** never let the ball go (almost) straight up and down: it would never come back */
    keepAngle(b) {
        const s = Math.hypot(b.vx, b.vy), min = s * 0.35;
        if (Math.abs(b.vx) < min) {
            b.vx = (b.vx < 0 ? -1 : 1) * min;
            b.vy = (b.vy < 0 ? -1 : 1) * Math.sqrt(s * s - min * min);
        }
    }

    damage(k) {
        k.flash = 140;
        if (k.steel) { this.events.push({ type: 'steel' }); return; }
        k.hp--;
        this.score += 10;
        if (k.hp > 0) { this.events.push({ type: 'hit' }); return; }
        this.streak++;
        this.score += 40 * k.max + 10 * Math.min(this.streak - 1, 20);
        this.bricks.splice(this.bricks.indexOf(k), 1);
        this.events.push({ type: 'break', x: k.x + k.w / 2, y: k.y + k.h / 2, max: k.max });
        if (k.bonus || this.rand() < DROP_CHANCE) {
            const kind = k.bonus ? POWERS[Math.floor(this.rand() * 3)] : POWERS[Math.floor(this.rand() * POWERS.length)];
            this.drops.push({ x: k.x + k.w / 2, y: k.y + k.h / 2, kind });
        }
        if (!this.remaining()) this.clearLevel();
    }

    stepDrops(ms) {
        const p = this.paddle;
        for (const d of this.drops) {
            d.x -= DROP_SPEED * ms / 1000;
            if (d.x <= PADDLE_X + PADDLE_T + 14 && d.x >= PADDLE_X - 14 && Math.abs(d.y - p.y) <= p.h / 2 + 14) { d.done = true; this.power(d.kind); }
            if (d.x < -20) d.done = true;
        }
        this.drops = this.drops.filter((d) => !d.done);
    }

    power(kind) {
        this.events.push({ type: 'power', kind });
        this.score += 25;
        if (kind === 'wide') { this.wideMs = WIDE_MS; this.setPaddleH(PADDLE_WIDE); } else if (kind === 'slow') { this.slowMs = SLOW_MS; this.rescale(); } else if (kind === 'life') this.lives = Math.min(MAX_LIVES, this.lives + 1);
        else if (kind === 'multi') {
            const src = this.balls.filter((b) => !b.stuck)[0];
            if (!src) return;
            const s = Math.hypot(src.vx, src.vy), a0 = Math.atan2(src.vy, src.vx);
            for (const da of [-0.45, 0.45]) {
                const b = { x: src.x, y: src.y, vx: Math.cos(a0 + da) * s, vy: Math.sin(a0 + da) * s, stuck: false };
                this.keepAngle(b);
                this.balls.push(b);
            }
        }
    }

    loseLife() {
        this.lives--;
        this.drops = [];
        this.wideMs = 0; this.slowMs = 0; this.setPaddleH(PADDLE_H);
        this.events.push({ type: 'miss' });
        if (this.lives <= 0) { this.lives = 0; this.over = true; this.state = 'over'; this.events.push({ type: 'over', score: this.score }); return; }
        this.serve();
    }

    clearLevel() {
        this.score += 250 * (this.level + 1) + 100 * this.lives;
        this.events.push({ type: 'clear', level: this.level + 1 });
        this.level++;
        this.loadLevel();
    }

    /** events since the last call (and forgets them) */
    takeEvents() { const e = this.events; this.events = []; return e; }
}

module.exports = {
    Engine, FW, FH, PADDLE_X, PADDLE_T, BALL_R, BRICK_X0, BRICK_W, BRICK_H, BRICK_GAP, KNOB_STEP, LEVELS,
};
