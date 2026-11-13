'use strict';
/**
 * Block Drop in the shell's Night Circuit look (api.style): a glass well lit in the game's green,
 * glossy cells that glow, shards bursting into sparks when cells clear, score popups, shake on a
 * hard drop and the chain counter. index.js builds it with makeLook(S, ctx) when api.style is there
 * and keeps its own drawing otherwise (and in dev/preview.html, which doesn't load this file).
 */
const HUE = '#6ff59a';

function makeLook(S, ctx) {
    const P = S.P, eng = ctx.eng, engine = ctx.engine, CELL = ctx.CELL, WX = ctx.WX, WY = ctx.WY;
    const cols = ctx.cols, rows = ctx.rows, wellW = cols * CELL, wellH = rows * CELL, W = ctx.W;
    const COL = [P.warn, P.cold, '#ff4fa8', HUE];
    const SPARK = engine.SPARK;
    const parts = new S.Particles(360), pops = new S.Popups(), shake = new S.Shake();
    let phase = eng.phase, score = eng.score, marked = null, landed = 0, chainK = 0, note = null;
    const LX = 16, LW = WX - 40 - LX, RX = WX + wellW + 40, RW = W - 16 - RX, PH = ctx.BTN_Y - 48 - 14;
    const cx = (c) => WX + c * CELL + CELL / 2, cy = (r) => WY + r * CELL + CELL / 2;

    function event(e) {
        if (e.type === 'rows') note = { text: e.n === 1 ? 'Row' : e.n + ' rows', c: P.ink, t: 1 };
        else if (e.type === 'burst') note = { text: e.n === 1 ? 'Burst ' + e.cells : e.n + ' bursts', c: P.cold, t: 1 };
        else if (e.type === 'chain') { chainK = 1; note = { text: 'Chain x' + e.n, c: P.gold, t: 1 }; shake.kick(4 + 2 * e.n); }
        else if (e.type === 'spark') { note = { text: e.colour >= 0 ? 'Spark' : 'Spark +50', c: '#ffffff', t: 1 }; shake.kick(6); }
        else if (e.type === 'level') { note = { text: 'Level ' + e.level, c: HUE, t: 1.4 }; parts.burst(WX + wellW / 2, WY + 30, HUE, 40, { speed: 600, life: 900 }); }
        else if (e.type === 'over') shake.kick(16);
    }
    function dropped() { shake.kick(5); landed = 1; }

    function update(dt) {
        if (eng.phase !== phase) {
            if (eng.phase === 'clear' && eng.marked) {
                marked = eng.marked.map((m) => [m[0], m[1], eng.board[m[1]][m[0]]]);
                const gain = eng.score - score;
                if (gain > 0 && marked.length) {
                    let sx = 0, sy = 0; marked.forEach((m) => { sx += cx(m[0]); sy += cy(m[1]); });
                    pops.add('+' + gain, sx / marked.length, sy / marked.length, P.gold, { size: 40 });
                }
            } else if (phase === 'clear' && marked) {
                marked.forEach((m) => parts.burst(cx(m[0]), cy(m[1]), m[2] >= 0 && m[2] < 4 ? COL[m[2]] : '#ffffff', 5, { speed: 380, life: 600, gravity: 500, size: 4 }));
                shake.kick(Math.min(12, 2 + marked.length / 4));
                marked = null;
            }
            phase = eng.phase;
        }
        score = eng.score;
        landed = Math.max(0, landed - dt / 200);
        chainK = Math.max(0, chainK - dt / 1500);
        if (note) { note.t -= dt / 1600; if (note.t <= 0) note = null; }
        parts.update(dt); pops.update(dt); shake.update(dt);
    }

    function cell(cv, x, y, v, opts) {
        opts = opts || {};
        const s = opts.size || CELL, g = 2, now = ctx.now();
        if (v === SPARK) {
            const p = 0.5 + 0.5 * Math.sin(now / 120);
            S.glowRect(cv, x + g, y + g, s - 2 * g, s - 2 * g, 8, '#ffffff', 0.5 + 0.5 * p);
            cv.roundRect(x + g, y + g, s - 2 * g, s - 2 * g, 8, S.a('#ffffff', 0.25 + 0.2 * p));
            cv.roundRect(x + s * 0.28, y + s * 0.28, s * 0.44, s * 0.44, 5, '#ffffff');
            return;
        }
        const c = opts.flash ? '#ffffff' : COL[v];
        S.block(cv, x + g, y + g, s - 2 * g, s - 2 * g, 7, c, opts.glow || 0);
    }

    function shard(cv, kind, colours, x, y, size) {
        const cells = engine.SHAPES[kind].cells;
        let x0 = 9, x1 = -9, y0 = 9, y1 = -9;
        cells.forEach((c) => { x0 = Math.min(x0, c[0]); x1 = Math.max(x1, c[0]); y0 = Math.min(y0, c[1]); y1 = Math.max(y1, c[1]); });
        const ox = x - ((x1 - x0 + 1) * size) / 2, oy = y - ((y1 - y0 + 1) * size) / 2;
        cells.forEach((c, i) => cell(cv, ox + (c[0] - x0) * size, oy + (c[1] - y0) * size, colours[i], { size, glow: 0.5 }));
    }

    function well(cv, ox, oy) {
        const x = WX + ox, y = WY + oy;
        S.glowRect(cv, x - 6, y - 6, wellW + 12, wellH + 12, 12, HUE, 0.5 + 0.8 * landed);
        cv.roundRect(x - 6, y - 6, wellW + 12, wellH + 12, 12, S.a(HUE, 0.35));
        cv.gradientRect(x, y, wellW, wellH, [[0, '#070b14'], [1, '#03050a']]);
        for (let c = 1; c < cols; c++) cv.fillRect(x + c * CELL, y, 1, wellH, [255, 255, 255, 10]);
        for (let r = 1; r < rows; r++) cv.fillRect(x, y + r * CELL, wellW, 1, [255, 255, 255, 10]);
        const mk = {};
        if (eng.marked) eng.marked.forEach((m) => { mk[m[1] * cols + m[0]] = true; });
        const blink = eng.phase === 'clear' && Math.floor(eng.timer / 80) % 2 === 0;
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
            const v = eng.board[r][c];
            if (v >= 0) cell(cv, x + c * CELL, y + r * CELL, v, { flash: mk[r * cols + c] && blink, glow: mk[r * cols + c] ? 1 : 0 });
        }
        for (const g of eng.ghostCells()) {
            if (g[1] < 0) continue;
            const col = g[2] === SPARK ? '#ffffff' : COL[g[2]];
            cv.roundRect(x + g[0] * CELL + 4, y + g[1] * CELL + 4, CELL - 8, CELL - 8, 6, S.a(col, 0.08));
            cv.strokeRoundRect(x + g[0] * CELL + 4, y + g[1] * CELL + 4, CELL - 8, CELL - 8, 6, 2, S.a(col, 0.5));
        }
        for (const p of eng.pieceCells()) if (p[1] >= 0) cell(cv, x + p[0] * CELL, y + p[1] * CELL, p[2], { glow: 0.7 });
    }

    function buttons(cv) {
        const st = ctx.state();
        for (const b of ctx.buttons) {
            const down = st.pressedBtn === b[0] && st.now - st.pressedT < 140;
            const id = b[0], x = b[1], y = b[2], w = b[3], h = b[4];
            S.panel(cv, x, y, w, h, { r: 16, accent: down ? HUE : null, glow: down });
            if (down) cv.roundRect(x, y, w, h, 16, S.a(HUE, 0.18));
            const bx = x + w / 2, by = y + h / 2 - 14, ic = down ? HUE : P.ink;
            ctx.icon(cv, id, bx, by, ic);
            S.label(cv, b[5], bx, y + h - 22, P.dim, { align: 'center', size: 14 });
        }
    }

    function draw(cv) {
        const st = ctx.state(), ox = shake.x, oy = shake.y;
        S.backdrop(cv, 0, 44, W, ctx.H - 44, { tint: HUE, grid: CELL, horizon: 0.3 });
        // left: score
        S.panel(cv, LX, 48, LW, PH, { r: 18, accent: HUE, bar: true });
        S.label(cv, 'Block Drop', LX + 28, 84, HUE, { size: 15 });
        S.stat(cv, 'Score', eng.score, LX + 28, 180, { size: 64, glow: true, color: P.ink });
        S.stat(cv, 'Level', eng.level, LX + 28, 266, { size: 40, color: HUE });
        const best = Math.max(ctx.best, eng.score);
        S.stat(cv, 'Best', best, LX + 200, 266, { size: 40, color: eng.score > ctx.best && ctx.best > 0 ? P.gold : P.dim });
        S.label(cv, 'Rows ' + eng.lines + '   Bursts ' + eng.bursts, LX + 28, 316, P.dim, { size: 13 });
        // right: next + tips
        S.panel(cv, RX, 48, RW, PH, { r: 18 });
        S.label(cv, 'Next', RX + 28, 84, P.dim, { size: 13 });
        cv.roundRect(RX + 24, 98, 150, 110, 12, [3, 5, 10, 220]);
        shard(cv, eng.next.kind, eng.next.colours, RX + 99, 153, 34);
        const tips = ['Fill a row to clear it', 'Join 4 of one colour: burst', 'Spark wipes the colour below', 'Tap the well: swap colours'];
        tips.forEach((s, i) => { cv.circle(RX + 200, 104 + i * 30, 3, COL[i % 4]); cv.text(s, RX + 212, 110 + i * 30, 18, P.dim, {}); });
        if (note) {
            cv.alpha(Math.min(1, note.t * 2));
            cv.text(note.text, RX + 28, 286, 36, note.c, { font: 'bold', literal: true });
            cv.alpha(1);
        }
        cv.text('Knob: turn move, press rotate, up swap, down drop', RX + 28, 318, 16, P.faint, {});
        well(cv, ox, oy);
        buttons(cv);
        parts.draw(cv, ox, oy);
        pops.draw(cv, ox, oy);
        if (eng.over() || st.paused) {
            cv.fillRect(WX, WY, wellW, wellH, [0, 0, 0, 165]);
            if (st.paused) S.label(cv, 'Paused', WX + wellW / 2, WY + wellH / 2, P.ink, { align: 'center', size: 20 });
        }
        return cv;
    }

    return { event, update, draw, dropped };
}

/** The menu tile: a shard falling into a well, a row lighting up and clearing */
function art(cv, x, y, w, h, S, ms) {
    const P = S.P, COL = [P.warn, P.cold, '#ff4fa8', HUE], cs = Math.min(18, (h - 16) / 6), n = 8;
    const wx = x + w / 2 - n * cs / 2, wy = y + h - 8 - 6 * cs, t = (ms % 3000) / 3000;
    cv.roundRect(wx - 4, wy - 4, n * cs + 8, 6 * cs + 8, 6, S.a(HUE, 0.25));
    cv.fillRect(wx, wy, n * cs, 6 * cs, '#05080f');
    const base = [[0, 1, 2, 0, -1, 1, 3, 2], [1, 3, 0, 2, 1, 0, 2, 1]];
    const full = t > 0.55 && t < 0.8, flash = full && Math.floor(t * 40) % 2 === 0;
    for (let r = 0; r < 2; r++) for (let c = 0; c < n; c++) {
        const v = base[r][c], yy = wy + (4 + r) * cs;
        if (r === 0 && t >= 0.8) continue;
        if (v < 0 && !(t >= 0.55 && r === 0)) continue;
        const col = r === 0 && full ? (flash ? '#ffffff' : HUE) : COL[v < 0 ? 3 : v];
        S.block(cv, wx + c * cs + 1, yy + 1, cs - 2, cs - 2, 3, col, r === 0 && full ? 0.8 : 0);
    }
    const fy = wy + Math.min(t / 0.55, 1) * 4 * cs;
    if (t < 0.55) S.block(cv, wx + 4 * cs + 1, fy + 1, cs - 2, cs - 2, 3, HUE, 0.6);
    S.block(cv, wx + 4 * cs + 1, fy - cs + 1 + (t >= 0.8 ? cs : 0), cs - 2, cs - 2, 3, P.cold, t < 0.55 ? 0.6 : 0);
}

module.exports = { makeLook, art, HUE };
