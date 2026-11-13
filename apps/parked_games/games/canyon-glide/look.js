'use strict';
/**
 * Canyon Glide in the shell's Night Circuit look (api.style): a dark cave whose rock edges glow
 * amber, crystals that shine, a glider with a light trail, sparks and shake on crashes and pick-ups.
 * Fx watches the round for events (no change to the rules in game.js).
 */
const { W, H, GX, READY_S } = require('./game');

const HUE = '#ffad42', ICE = '#5ff0d4';

class Fx {
    constructor(S) {
        this.S = S;
        this.parts = new S.Particles(300);
        this.pops = new S.Popups();
        this.shake = new S.Shake();
        this.crystals = 0; this.state = 'ready'; this.flash = 0;
    }
    update(dt, r) {
        const S = this.S;
        if (r.crystals > this.crystals) {
            this.crystals = r.crystals;
            this.parts.burst(GX + 10, r.y, ICE, 26, { speed: 460, life: 600 });
            this.pops.add('+25', GX + 40, r.y - 30, ICE, { size: 40 });
            this.flash = 1; this.shake.kick(3);
        }
        if (r.state !== this.state) {
            if (r.state === 'crash') {
                this.parts.burst(GX, r.y, HUE, 50, { speed: 760, life: 900, gravity: 500 });
                this.parts.burst(GX, r.y, '#ffffff', 16, { speed: 420, life: 400 });
                this.shake.kick(18);
            }
            this.state = r.state;
        }
        if (r.state === 'play' && r.boosting > 0.05 && Math.random() < 0.9) {
            const a = -r.pitch * 0.55;
            this.parts.burst(GX - 22 * Math.cos(a), r.y - 22 * Math.sin(a), HUE, 1, { dir: 180 + a * 57.3, spread: 20, speed: 300, life: 260, size: 2.5 });
        }
        this.flash = Math.max(0, this.flash - dt / 400);
        this.parts.update(dt); this.pops.update(dt); this.shake.update(dt);
        void S;
    }
}

/** rock between a trace and an edge of the screen, one quad per segment */
function fillTo(cv, pts, baseY, c) {
    for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        cv.quad([[a[0], a[1]], [b[0] + 0.75, b[1]], [b[0] + 0.75, baseY], [a[0], baseY]], c);
    }
}

function far(cv, r, S, oy) {
    const off = r.dist * 0.4, top = [], bot = [];
    for (let x = -80; x <= W + 80; x += 80) {
        const w = x + off;
        const a = Math.sin(w * 0.004) * 40 + Math.sin(w * 0.0113 + 1.3) * 22;
        const b = Math.sin(w * 0.0051 + 2.1) * 36 + Math.sin(w * 0.0137) * 20;
        top.push([x, 70 + a + oy]); bot.push([x, H - 70 + b + oy]);
    }
    const c = S.mix(S.P.bg1, '#6a4cff', 0.12);
    fillTo(cv, top, 0, c); fillTo(cv, bot, H, c);
    cv.polyline(top, 2, S.a('#9d7bff', 0.25)); cv.polyline(bot, 2, S.a('#9d7bff', 0.25));
}

function rock(cv, r, S, ox, oy) {
    const cave = r.cave, step = 40, top = [], bot = [], top2 = [], bot2 = [];
    const x0 = Math.floor(r.dist / step) * step;
    for (let w = x0; w <= r.dist + W + step; w += step) {
        const s = cave.at(w), x = w - r.dist + ox;
        top.push([x, s.ceil + oy]); bot.push([x, s.floor + oy]);
        top2.push([x, s.ceil - 22 + oy]); bot2.push([x, s.floor + 22 + oy]);
    }
    fillTo(cv, top, 0, '#1a1118'); fillTo(cv, bot, H, '#1a1118');
    fillTo(cv, top2, 0, '#0c080c'); fillTo(cv, bot2, H, '#0c080c');
    for (const p of cave.spires) {
        if (p.x + p.w < r.dist || p.x - p.w > r.dist + W) continue;
        const t = cave.tri(p).map((q) => [q[0] - r.dist + ox, q[1] + oy]);
        cv.quad([t[0], t[1], t[2], t[2]], '#1a1118');
        S.glowLine(cv, t[0][0] + 6, t[0][1], t[2][0], t[2][1], 2.5, HUE, 0.8);
        S.glowLine(cv, t[1][0] - 6, t[1][1], t[2][0], t[2][1], 2.5, HUE, 0.8);
    }
    // the glowing edges: a wide faint halo, then the line
    cv.polyline(top, 14, S.a(HUE, 0.06)); cv.polyline(bot, 14, S.a(HUE, 0.06));
    cv.polyline(top, 7, S.a(HUE, 0.16)); cv.polyline(bot, 7, S.a(HUE, 0.16));
    cv.polyline(top, 2.5, HUE); cv.polyline(bot, 2.5, HUE);
}

function crystals(cv, r, S, ox, oy) {
    const pulse = 1 + Math.sin(r.clock * 6) * 0.12;
    for (const c of r.cave.crystals) {
        if (c.taken) continue;
        const x = c.x - r.dist + ox, y = c.y + oy;
        if (x < -40 || x > W + 40) continue;
        const s = 14 * pulse;
        S.halo(cv, x, y, 60 * pulse, ICE, 1.6);
        cv.quad([[x, y - s * 1.5], [x + s, y], [x, y + s * 1.5], [x - s, y]], ICE);
        cv.quad([[x, y - s * 1.5], [x + s, y], [x, y], [x, y]], S.lighten(ICE, 0.5));
        cv.quad([[x, y - s * 0.6], [x + s * 0.35, y], [x, y + s * 0.6], [x - s * 0.35, y]], '#ffffff');
        const tw = 0.5 + 0.5 * Math.sin(r.clock * 9 + c.x);
        cv.line(x - 22 * tw, y - 18, x + 22 * tw, y - 18, 1.5, S.a('#ffffff', 0.5 * tw));
    }
}

function trail(cv, r, S, ox, oy) {
    const n = r.trail.length;
    if (n < 2 || r.state !== 'play') return;
    const col = r.boosting > 0.05 ? HUE : S.P.cold;
    for (let i = 1; i < n; i++) {
        const a = r.trail[i - 1], b = r.trail[i], k = i / n;
        cv.line(a[0] - r.dist - 18 + ox, a[1] + oy, b[0] - r.dist - 18 + ox, b[1] + oy, (2 + k * 5) * (1 + r.boosting), S.a(col, 0.08 + 0.25 * k));
        cv.line(a[0] - r.dist - 18 + ox, a[1] + oy, b[0] - r.dist - 18 + ox, b[1] + oy, 1 + k * 1.5, S.a(col, 0.6 * k));
    }
}

function glider(cv, r, S, ox, oy) {
    const x = GX + ox, y = r.y + oy, a = -r.pitch * 0.55, ca = Math.cos(a), sa = Math.sin(a);
    const P = (u, v) => [x + u * ca - v * sa, y + u * sa + v * ca];
    S.halo(cv, x, y, 70, S.P.cold, 1.2);
    if (r.boosting > 0.05) {
        const f = 22 + r.boosting * 34 + Math.sin(r.clock * 40) * 6;
        cv.quad([P(-18, -5), P(-18, 5), P(-18 - f * 1.3, 1.5), P(-18 - f * 1.3, -1.5)], S.a(HUE, 0.35));
        cv.quad([P(-18, -3), P(-18, 3), P(-18 - f, 1), P(-18 - f, -1)], S.lighten(HUE, 0.4));
    }
    cv.quad([P(-6, -2), P(14, -2), P(-20, -16), P(-26, -14)], '#8a93a8');
    cv.quad([P(-24, -4), P(26, -2), P(26, 3), P(-24, 5)], '#f4f6fb');
    cv.quad([P(26, -2), P(34, 0), P(34, 1), P(26, 3)], '#ffffff');
    cv.quad([P(-4, 2), P(16, 2), P(-18, 16), P(-25, 14)], '#e8ecf4');
    cv.quad([P(-8, 4), P(6, 4), P(-14, 12), P(-18, 11)], S.P.cold);
    cv.quad([P(-24, -4), P(-18, -4), P(-26, -14), P(-30, -14)], '#8a93a8');
    const tip = P(-25, 15), tail = P(-28, -14);
    cv.circle(tip[0], tip[1], 2.5, Math.floor(r.clock * 2) % 2 ? '#ff5a5a' : S.a('#ff5a5a', 0.3));
    cv.circle(tail[0], tail[1], 2.5, Math.floor(r.clock * 2) % 2 ? S.a('#5aff9a', 0.3) : '#5aff9a');
}

function hud(cv, r, S, how) {
    const P = S.P, y = 98;
    cv.gradientRect(0, 40, W, 90, [[0, [5, 7, 13, 210]], [0.7, [5, 7, 13, 150]], [1, [5, 7, 13, 0]]]);
    S.stat(cv, 'Score', r.score(), 24, y, { size: 44, color: S.mix(P.ink, ICE, r.flash > 0 ? 0.8 : 0) });
    S.stat(cv, 'Best', r.best, 220, y, { size: 32, color: P.dim });
    S.stat(cv, 'Distance', r.metres(), 380, y, { size: 32, unit: 'm', color: HUE });
    const bw = 280, bx = W - 24 - bw, low = r.energy < 0.2;
    S.label(cv, 'Boost', bx, y - 34, low && Math.floor(r.clock * 4) % 2 ? P.bad : P.dim, { size: 13 });
    S.meter(cv, bx, y - 24, bw, 12, r.energy, low ? P.bad : HUE, { glow: r.boosting > 0.05 });
    cv.text(how.boost, bx, y + 4, 14, P.faint, { font: 'label' });
    if (r.state === 'ready') S.countdown(cv, W / 2, H / 2 + 6, Math.max(1, (READY_S - r.t) * 1000), 800, HUE, how.steer);
}

function draw(cv, r, S, fx, how) {
    const ox = fx.shake.x, oy = fx.shake.y;
    cv.gradientRect(0, 0, W, H, [[0, S.P.bg0], [0.5, '#120c1c'], [1, S.P.bg0]]);
    far(cv, r, S, oy * 0.5);
    rock(cv, r, S, ox, oy);
    crystals(cv, r, S, ox, oy);
    trail(cv, r, S, ox, oy);
    if (r.state !== 'crash' && r.state !== 'over') glider(cv, r, S, ox, oy);
    fx.parts.draw(cv, ox, oy);
    fx.pops.draw(cv, ox, oy);
    S.flash(cv, 0, 0, W, H, ICE, fx.flash * 0.35);
    S.vignette(cv, 0, 0, W, H, 0.8);
    hud(cv, r, S, how || { steer: '', boost: '' });
}

/** The menu tile: the glider through a glowing cave, a crystal ahead */
function art(cv, x, y, w, h, S, ms) {
    const t = ms / 1000, off = t * 60, top = [], bot = [];
    for (let i = 0; i <= 12; i++) {
        const px = x + (i / 12) * w, wx = px + off;
        top.push([px, y + h * 0.22 + Math.sin(wx * 0.03) * 12 + Math.sin(wx * 0.011) * 10]);
        bot.push([px, y + h * 0.78 + Math.sin(wx * 0.027 + 1) * 12 + Math.sin(wx * 0.013) * 10]);
    }
    fillTo(cv, top, y, '#1a1118'); fillTo(cv, bot, y + h, '#1a1118');
    cv.polyline(top, 6, S.a(HUE, 0.15)); cv.polyline(bot, 6, S.a(HUE, 0.15));
    cv.polyline(top, 2, HUE); cv.polyline(bot, 2, HUE);
    const gy = y + h / 2 + Math.sin(t * 1.6) * 10, gx = x + w * 0.35;
    cv.line(x, gy + 2, gx - 16, gy, 2, S.a(S.P.cold, 0.5));
    cv.quad([[gx - 16, gy - 2], [gx + 18, gy - 1], [gx + 18, gy + 2], [gx - 16, gy + 3]], '#f4f6fb');
    cv.quad([[gx - 3, gy + 1], [gx + 10, gy + 1], [gx - 12, gy + 11], [gx - 16, gy + 10]], '#e8ecf4');
    const cx = x + w * 0.78, s = 8 + Math.sin(t * 6);
    S.halo(cv, cx, y + h / 2, 34, ICE, 1.6);
    cv.quad([[cx, y + h / 2 - s * 1.5], [cx + s, y + h / 2], [cx, y + h / 2 + s * 1.5], [cx - s, y + h / 2]], ICE);
}

module.exports = { Fx, draw, art, HUE };
