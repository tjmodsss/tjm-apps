'use strict';
/**
 * Paddle Duel - a ball-and-paddle duel for a parked car.
 *
 *   your paddle            the iDrive knob: each click moves it, push up / down slides it
 *   the other paddle       the car (CPU), or a second player with a finger on that half of the screen
 *
 * What makes it more than "hit it back":
 *   - where the ball meets the paddle sets the angle it leaves at (the edge sends it steep)
 *   - a paddle that is moving when it hits puts spin on the ball: it curves in flight
 *   - every hit makes the ball a little faster; every 6th hit in a rally is a "hot shot" (much faster)
 *   - after the first point a bumper drifts up and down the centre line and knocks the ball off course
 *
 * Pure game logic plus drawing on the kit's canvas (kit/runtime/record.js methods only).
 * No requires, no timers, no I/O: the host calls update(dt) and draw(cv, theme), and feeds input.
 * Written for Node 8 (the car's runtime): no ?. or ??, no class fields.
 */

const W = 1600, H = 520;
const COURT = { top: 112, bottom: 484 };           // the walls the ball bounces off (safe area y 44..512; the shell's status line sits below)
const PADDLE = { w: 18, h: 100, inset: 64 };        // inset: paddle centre from the screen's edge
const BALL_R = 11;
const SPEED = { start: 640, hit: 1.045, max: 1500, hot: 1.22 };
const MAX_ANGLE = 56 * Math.PI / 180;              // leaving angle at the paddle's very edge
const MIN_VX = 0.42;                                // |vx| never below this share of the speed (no endless wall bouncing)
const SPIN = { take: 1.1, max: 1100, decay: 1.4 };  // px/s^2 per px/s of paddle speed, cap, decay per s
const PADDLE_VMAX = 1500;                           // px/s a paddle can follow its target
const BUMPER = { x: W / 2, r: 28, period: 7.0, span: 120 };
const HOT_EVERY = 6;
const SERVE_S = 1.1, POINT_S = 0.9;
const TRAIL = 10;

// err: how far off the car aims (px) at the serve speed; it grows with the square of the ball's speed,
// so long, fast rallies end. vmax: how fast its paddle moves. think: seconds between looks at the ball.
const CPU_LEVEL = {
    easy: { vmax: 420, think: 0.18, err: 46 },
    normal: { vmax: 600, think: 0.12, err: 30 },
    hard: { vmax: 820, think: 0.08, err: 20 },
};

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const travel = () => (COURT.bottom - COURT.top - PADDLE.h) / 2;   // a paddle's centre: mid +- this
const MID = (COURT.top + COURT.bottom) / 2;

/** '#rrggbb' + alpha 0..1 -> '#rrggbbaa' (alpha in 1/32 steps, so the renderer's colour cache stays small) */
function alpha(hex, a) {
    const s = String(hex || '#ffffff');
    const base = s.length >= 7 ? s.slice(0, 7) : '#ffffff';
    const q = Math.round(clamp(a, 0, 1) * 32) / 32;
    const v = Math.round(q * 255).toString(16);
    return base + (v.length < 2 ? '0' + v : v);
}

class Paddle {
    constructor(side) {
        this.side = side;                                       // 'L' or 'R'
        this.x = side === 'L' ? PADDLE.inset : W - PADDLE.inset;
        this.y = MID; this.target = MID; this.vy = 0;
        this.ctl = 'cpu';                                       // 'knob' | 'touch' | 'cpu'
        this.score = 0;
        this.tilt = 0;                                          // -1 up, +1 down (knob pushed)
        // cpu
        this.think = 0; this.aim = MID;
    }
    setTarget(y) { this.target = clamp(y, MID - travel(), MID + travel()); }
    step(dt) {
        if (this.tilt) this.setTarget(this.target + this.tilt * 900 * dt);
        const want = (this.target - this.y) * 22;
        const vmax = this.vmax || PADDLE_VMAX;
        this.vy = clamp(want, -vmax, vmax);
        this.y = clamp(this.y + this.vy * dt, MID - travel(), MID + travel());
    }
}

class PaddleDuel {
    /**
     * opts: { target: points to win (7), bumper: bool (true), cpu: 'easy'|'normal'|'hard',
     *         left: 'knob'|'touch'|'cpu', right: 'knob'|'touch'|'cpu',
     *         knobStep: px per click (34), random: () => 0..1 }
     */
    constructor(opts) {
        this.o = Object.assign({ target: 7, bumper: true, cpu: 'normal', left: 'knob', right: 'cpu',
            knobStep: 34, random: Math.random }, opts || {});
        this.rnd = this.o.random;
        this.L = new Paddle('L'); this.R = new Paddle('R');
        this.L.ctl = this.o.left; this.R.ctl = this.o.right;
        this.t = 0;
        this.ball = { x: W / 2, y: MID, vx: 0, vy: 0, spin: 0, speed: SPEED.start, hot: false };
        this.trail = [];
        this.rally = 0; this.longest = 0; this.hits = 0;
        this.bumperOn = false; this.bumperY = MID; this.bumperFlash = 0;
        this.state = 'ready';       // ready | serve | play | point | over
        this.timer = 0; this.serveTo = this.rnd() < 0.5 ? 'L' : 'R';
        this.lastPoint = null; this.winner = null;
        this.paused = false;
        this.flash = 0;             // hit flash
        this.events = [];           // ['hit', side] ['point', side] ['over', side] for the host (sounds, scores)
        this.names = null;          // { L, R }: the host's names for the sides (else from who plays them)
        this.hint = null;           // a line shown until the first hit of the match
        this.applyLevel();
    }

    /* ---------- setup ---------- */
    applyLevel() {
        const lv = CPU_LEVEL[this.o.cpu] || CPU_LEVEL.normal;
        [this.L, this.R].forEach((p) => { p.vmax = p.ctl === 'cpu' ? lv.vmax : PADDLE_VMAX; });
    }
    /** change who plays a side mid-game (e.g. a second player takes over from the car) */
    setControl(side, ctl) { this[side].ctl = ctl; this.applyLevel(); }
    label(side) {
        const l = this.names && this.names[side];
        if (l) return l;
        const c = this[side].ctl;
        return c === 'knob' ? 'YOU  ·  KNOB' : c === 'touch' ? 'PLAYER 2  ·  TOUCH' : 'CAR  ·  CPU';
    }

    /* ---------- input ---------- */
    /** knob turned by n clicks (+ = clockwise = paddle down) */
    knob(n) {
        const p = this.byCtl('knob');
        if (p && !this.paused) p.setTarget(p.target + n * this.o.knobStep);
    }
    /** knob pushed: 'N' up, 'S' down, null released ('E'/'W' ignored) */
    tilt(dir) {
        const p = this.byCtl('knob');
        if (p) p.tilt = dir === 'N' ? -1 : dir === 'S' ? 1 : 0;
    }
    /** knob pressed: start / rematch / resume */
    press() {
        if (this.paused) { this.paused = false; return 'resume'; }
        if (this.state === 'ready' || this.state === 'over') { this.newMatch(); return 'start'; }
        return null;
    }
    pause(on) { this.paused = on !== false; }
    byCtl(c) { return this.R.ctl === c ? this.R : this.L.ctl === c ? this.L : null; }

    /* ---------- match flow ---------- */
    newMatch() {
        this.L.score = 0; this.R.score = 0;
        this.rally = 0; this.longest = 0; this.hits = 0;
        this.bumperOn = false; this.winner = null; this.lastPoint = null;
        this.serve(this.rnd() < 0.5 ? 'L' : 'R');
    }
    serve(to) {
        this.serveTo = to;
        this.state = 'serve'; this.timer = SERVE_S;
        const b = this.ball;
        // with the bumper on the centre line, the ball waits beside it, on the receiver's side
        b.x = W / 2 + (this.bumperOn ? (to === 'L' ? -1 : 1) * (BUMPER.r + 70) : 0);
        b.y = MID; b.vx = 0; b.vy = 0; b.spin = 0; b.speed = SPEED.start; b.hot = false;
        this.trail.length = 0; this.rally = 0;
    }
    launch() {
        const b = this.ball, dir = this.serveTo === 'L' ? -1 : 1;
        const a = (this.rnd() * 2 - 1) * 0.42;      // up to ~24 degrees
        b.vx = dir * b.speed * Math.cos(a); b.vy = b.speed * Math.sin(a);
        this.state = 'play';
    }
    point(side) {
        this[side].score++;
        this.lastPoint = side;
        this.longest = Math.max(this.longest, this.rally);
        this.events.push(['point', side]);
        if (this.o.bumper && !this.bumperOn) this.bumperOn = true;
        if (this[side].score >= this.o.target) {
            this.state = 'over'; this.winner = side; this.timer = 0;
            this.events.push(['over', side]);
            return;
        }
        this.state = 'point'; this.timer = POINT_S;
    }

    /* ---------- simulation ---------- */
    update(dt) {
        if (!(dt > 0)) return;
        dt = Math.min(dt, 0.1);
        this.t += dt;
        if (this.paused) return;
        const n = Math.ceil(dt / (1 / 240));
        const h = dt / n;
        for (let i = 0; i < n; i++) this.tick(h);
        this.flash = Math.max(0, this.flash - dt * 3);
        this.bumperFlash = Math.max(0, this.bumperFlash - dt * 3);
    }
    tick(h) {
        this.cpu(this.L, h); this.cpu(this.R, h);
        this.L.step(h); this.R.step(h);
        if (this.bumperOn) this.bumperY = MID + Math.sin(this.t * 2 * Math.PI / BUMPER.period) * BUMPER.span;
        if (this.state === 'serve') { this.timer -= h; if (this.timer <= 0) this.launch(); return; }
        if (this.state === 'point') { this.timer -= h; if (this.timer <= 0) this.serve(this.lastPoint === 'L' ? 'R' : 'L'); return; }
        if (this.state !== 'play') return;

        const b = this.ball;
        const px = b.x;
        // spin curves the ball, and wears off
        b.vy += b.spin * h;
        b.spin *= Math.exp(-SPIN.decay * h);
        b.x += b.vx * h; b.y += b.vy * h;
        // walls
        if (b.y < COURT.top + BALL_R) { b.y = 2 * (COURT.top + BALL_R) - b.y; b.vy = Math.abs(b.vy); b.spin *= -0.5; }
        if (b.y > COURT.bottom - BALL_R) { b.y = 2 * (COURT.bottom - BALL_R) - b.y; b.vy = -Math.abs(b.vy); b.spin *= -0.5; }
        // paddles
        this.paddleHit(this.L, px); this.paddleHit(this.R, px);
        // bumper
        if (this.bumperOn) this.bumperHit();
        // out
        if (b.x < -BALL_R * 2) this.point('R');
        else if (b.x > W + BALL_R * 2) this.point('L');
        if (this.state === 'play' && Math.floor(this.t * 60) !== this.lastTrail) {
            this.lastTrail = Math.floor(this.t * 60);
            this.trail.push([b.x, b.y]); if (this.trail.length > TRAIL) this.trail.shift();
        }
    }
    paddleHit(p, px) {
        const b = this.ball;
        const dir = p.side === 'L' ? -1 : 1;              // the way the ball travels towards this paddle
        if (Math.sign(b.vx) !== dir) return;
        const face = p.x - dir * PADDLE.w / 2;            // the face the ball meets
        const edge = b.x + dir * BALL_R, pedge = px + dir * BALL_R;
        // crossed the face this step (or already sitting in it)
        const crossed = dir < 0 ? (pedge >= face && edge <= face) : (pedge <= face && edge >= face);
        if (!crossed) return;
        const reach = PADDLE.h / 2 + BALL_R;
        const off = b.y - p.y;
        if (Math.abs(off) > reach) return;
        const o = clamp(off / reach, -1, 1);
        const a = o * MAX_ANGLE;
        this.rally++; this.hits++;
        b.hot = this.rally % HOT_EVERY === 0;
        b.speed = Math.min(SPEED.max, b.speed * SPEED.hit) * (b.hot ? SPEED.hot : 1);
        b.speed = Math.min(b.speed, SPEED.max * SPEED.hot);
        b.vx = -dir * b.speed * Math.cos(a);
        b.vy = b.speed * Math.sin(a);
        b.spin = clamp(p.vy * SPIN.take, -SPIN.max, SPIN.max);
        b.x = face - dir * BALL_R;                        // out of the paddle
        this.flash = 1;
        this.events.push(['hit', p.side]);
        // the cpu re-thinks once the ball comes its way
        [this.L, this.R].forEach((q) => { q.think = 0; });
    }
    bumperHit() {
        const b = this.ball;
        const dx = b.x - BUMPER.x, dy = b.y - this.bumperY;
        const d = Math.sqrt(dx * dx + dy * dy), min = BUMPER.r + BALL_R;
        if (d >= min || d === 0) return;
        const nx = dx / d, ny = dy / d;
        const dot = b.vx * nx + b.vy * ny;
        if (dot >= 0) return;                             // already leaving
        b.vx -= 2 * dot * nx; b.vy -= 2 * dot * ny;
        b.x = BUMPER.x + nx * min; b.y = this.bumperY + ny * min;
        this.keepGoing();
        b.spin *= 0.3;
        this.bumperFlash = 1;
        this.events.push(['bumper', null]);
    }
    /** never let the ball bounce (nearly) straight up and down */
    keepGoing() {
        const b = this.ball, s = Math.sqrt(b.vx * b.vx + b.vy * b.vy) || b.speed;
        if (Math.abs(b.vx) < MIN_VX * s) {
            const sx = b.vx < 0 ? -1 : 1;
            b.vx = sx * MIN_VX * s;
            b.vy = (b.vy < 0 ? -1 : 1) * Math.sqrt(Math.max(0, s * s - b.vx * b.vx));
        }
    }

    /* ---------- the car's own player ---------- */
    cpu(p, h) {
        if (p.ctl !== 'cpu') return;
        const lv = CPU_LEVEL[this.o.cpu] || CPU_LEVEL.normal;
        p.think -= h;
        if (p.think > 0) return;
        p.think = lv.think;
        const b = this.ball;
        const coming = this.state === 'play' && (p.side === 'L' ? b.vx < 0 : b.vx > 0);
        if (coming) {
            if (p.aimFor !== this.hits) {
                p.aimFor = this.hits;
                const f = b.speed / SPEED.start;
                p.err = (this.rnd() * 2 - 1) * lv.err * f * f;
            }
            p.aim = this.predict(p.x) + p.err;
        } else p.aim = MID + (b.y - MID) * 0.25;
        p.setTarget(p.aim);
    }
    /** where the ball crosses x, with its wall bounces (spin left out: the car can be fooled by a curve) */
    predict(x) {
        const b = this.ball;
        if (!b.vx) return MID;
        const t = (x - b.x) / b.vx;
        if (t < 0) return MID;
        const lo = COURT.top + BALL_R, hi = COURT.bottom - BALL_R, span = hi - lo;
        let y = b.y + b.vy * t - lo;
        y = ((y % (2 * span)) + 2 * span) % (2 * span);
        return lo + (y > span ? 2 * span - y : y);
    }

    /** events since the last call: [['hit','L'], ['point','R'], ['over','R'], ['bumper', null]] */
    takeEvents() { const e = this.events; this.events = []; return e; }
    result() { return { winner: this.winner, L: this.L.score, R: this.R.score, longestRally: this.longest, hits: this.hits }; }

    /* ---------- drawing ---------- */
    draw(cv, t) {
        t = t || {};
        const text = t.text || '#f4f7fb', dim = t.dim || '#8a95a6';
        const left = t.cold || '#7fd1ff', right = t.warn || '#ffb020';
        const accent = t.accent2 || '#81c4ff', hotC = t.crit || '#ef2b2d';
        // court
        cv.fillRect(0, COURT.top - 4, W, 4, alpha(t.panelEdge || '#242c39', 1));
        cv.fillRect(0, COURT.bottom, W, 4, alpha(t.panelEdge || '#242c39', 1));
        cv.fillRect(0, COURT.top, W / 2, COURT.bottom - COURT.top, alpha(left, 0.04));
        cv.fillRect(W / 2, COURT.top, W / 2, COURT.bottom - COURT.top, alpha(right, 0.04));
        for (let y = COURT.top + 10; y < COURT.bottom - 10; y += 30) cv.fillRect(W / 2 - 2, y, 4, 16, alpha(dim, 0.35));
        cv.arc(W / 2, MID, 80, 83, 0, 360, alpha(dim, 0.18));

        // header: names, scores, rally
        cv.text(this.label('L'), 40, 88, 24, left, { font: 'bold', spacing: 1.5 });
        cv.text(this.label('R'), W - 40, 88, 24, right, { font: 'bold', spacing: 1.5, align: 'right' });
        cv.text(String(this.L.score), W / 2 - 70, 100, 52, text, { font: 'num', align: 'center' });
        cv.text(String(this.R.score), W / 2 + 70, 100, 52, text, { font: 'num', align: 'center' });
        cv.text(':', W / 2, 94, 40, dim, { font: 'bold', align: 'center' });
        if (this.rally > 1 && this.state === 'play') cv.text('RALLY ' + this.rally, W / 2 + 260, 88, 22, this.ball.hot ? hotC : dim, { font: 'bold', spacing: 1.5, align: 'center' });
        else cv.text('FIRST TO ' + this.o.target, W / 2 + 260, 88, 22, dim, { font: 'bold', spacing: 1.5, align: 'center' });
        if (this.longest > 1) cv.text('BEST RALLY ' + this.longest, W / 2 - 260, 88, 22, dim, { font: 'bold', spacing: 1.5, align: 'center' });

        // bumper
        if (this.bumperOn) {
            cv.circle(BUMPER.x, this.bumperY, BUMPER.r + 10, alpha(accent, 0.10 + 0.35 * this.bumperFlash));
            cv.circle(BUMPER.x, this.bumperY, BUMPER.r, alpha(t.panelTop || '#141a24', 1));
            cv.arc(BUMPER.x, this.bumperY, BUMPER.r - 4, BUMPER.r, 0, 360, accent);
        }

        // paddles
        this.drawPaddle(cv, this.L, left);
        this.drawPaddle(cv, this.R, right);

        // ball and its trail
        const b = this.ball, bc = b.hot ? hotC : text;
        if (this.state === 'play' || this.state === 'serve') {
            this.trail.forEach((p, i) => cv.circle(p[0], p[1], BALL_R * (0.4 + 0.5 * i / TRAIL), alpha(bc, 0.05 + 0.3 * i / TRAIL)));
            if (b.hot) cv.circle(b.x, b.y, BALL_R + 9, alpha(hotC, 0.3));
            const blink = this.state === 'serve' && Math.floor(this.timer * 6) % 2 === 1;
            if (!blink) cv.circle(b.x, b.y, BALL_R, bc);
        }

        // messages (the shell draws its own result card when the match is over)
        if (this.state === 'point') {
            const c = this.lastPoint === 'L' ? left : right;
            cv.text('POINT', this.lastPoint === 'L' ? W * 0.25 : W * 0.75, MID + 14, 40, alpha(c, 0.9), { font: 'bold', align: 'center', spacing: 4 });
        }
        if (this.hint && this.hits === 0 && this.L.score + this.R.score === 0) {
            cv.text(this.hint, W / 2, COURT.bottom - 18, 22, dim, { font: 'bold', align: 'center' });
        }
        return cv;
    }
    drawPaddle(cv, p, c) {
        const x = p.x - PADDLE.w / 2, y = p.y - PADDLE.h / 2;
        const lit = this.flash > 0 && this.lastHitSide() === p.side;
        cv.roundRect(x - 6, y - 6, PADDLE.w + 12, PADDLE.h + 12, 12, alpha(c, lit ? 0.35 * this.flash + 0.1 : 0.1));
        cv.roundRect(x, y, PADDLE.w, PADDLE.h, 8, c);
    }
    lastHitSide() { return this.ball.vx > 0 ? 'L' : 'R'; }
    winnerName() {
        const c = this[this.winner].ctl;
        return c === 'knob' ? 'YOU' : c === 'touch' ? 'PLAYER 2' : 'THE CAR';
    }
}

module.exports = { PaddleDuel, W, H, COURT, PADDLE, BALL_R, SPEED, CPU_LEVEL, alpha };
