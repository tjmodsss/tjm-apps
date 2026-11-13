'use strict';
/**
 * Block Drop - the game module for Parked Games (see apps/parked_games/GAMES.md): input and drawing
 * around engine.js, which holds the rules.
 *
 * Controls:
 *   knob turn          move the shard left / right, one column a click
 *   knob press         rotate
 *   push N / S / E / W swap colours / drop / right / left
 *   touch              the four buttons beside the well (Rotate, Left, Right, Drop);
 *                      a tap on the well swaps colours
 *   keys (dev preview) arrows, space, enter, c
 */
// (engine.X, not destructured: dev/preview.html loads both files as plain scripts in one scope)
const engine = require('./engine');
const look = require('./look') || null;     // (undefined in dev/preview.html: the old drawing)
const SPARK_ID = engine.SPARK;

const W = 1600, H = 520;
const CELL = 38;
const PALETTE = ['#ffb020', '#2ec5ff', '#ff4fa3', '#5be36b'];      // amber, cyan, pink, green
const NAMES = ['amber', 'blue', 'pink', 'green'];
const SPARK_COL = '#ffffff';

const DEFAULT_THEME = {
    bg: '#04060a', panelTop: '#141a24', panelEdge: '#242c39', track: '#1b212b',
    text: '#f4f7fb', dim: '#8a95a6', accent: '#f4f7fb', accent2: '#81c4ff', crit: '#ef2b2d',
};

/** '#rrggbb' + alpha 0..1 -> [r, g, b, a] (the kit's colour arrays) */
function alpha(c, a) {
    if (Array.isArray(c)) return [c[0], c[1], c[2], Math.round(a * (c.length > 3 ? c[3] : 255))];
    const n = parseInt(String(c).slice(1, 7), 16);
    return [n >> 16, (n >> 8) & 255, n & 255, Math.round(Math.max(0, Math.min(1, a)) * 255)];
}
/** '#rrggbb' lighter (k > 0) or darker (k < 0) */
function shade(c, k) {
    const n = parseInt(c.slice(1, 7), 16);
    const f = (v) => { const x = Math.round(k > 0 ? v + (255 - v) * k : v * (1 + k)); return Math.max(0, Math.min(255, x)); };
    const r = f(n >> 16), g = f((n >> 8) & 255), b = f(n & 255);
    return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}

function create(api) {
    api = api || {};
    const cols = 10, rows = 12;
    const wellW = cols * CELL, wellH = rows * CELL;
    const WX = Math.round((W - wellW) / 2), WY = 52;                    // the shell keeps y 0..44 for its own frame

    // touch buttons: [id, x, y, w, h, label]
    const BTN_W = 200, BTN_H = 150, BTN_Y = 512 - BTN_H;
    const buttons = [
        ['rotate', WX - 40 - 2 * BTN_W - 20, BTN_Y, BTN_W, BTN_H, 'Rotate'],
        ['left', WX - 40 - BTN_W, BTN_Y, BTN_W, BTN_H, 'Left'],
        ['right', WX + wellW + 40, BTN_Y, BTN_W, BTN_H, 'Right'],
        ['drop', WX + wellW + 40 + BTN_W + 20, BTN_Y, BTN_W, BTN_H, 'Drop'],
    ];

    const seed = Math.floor((api.random ? api.random() : Math.random()) * 4294967296);
    const eng = new engine.BlockDrop({ cols, rows, seed });
    const best = Number(api.best && api.best()) || 0;
    let paused = false, ended = false;
    let flash = [];                 // messages: { text, colour, t }
    let pressedBtn = null, pressedT = 0;
    let now = 0;

    let fx = null;                  // the shell's Night Circuit look, when it hands us api.style (after draw's helpers)

    function say(text, colour) { flash.push({ text, colour, t: now }); if (flash.length > 3) flash.shift(); }

    function handleEvents() {
        for (const e of eng.takeEvents()) {
            if (fx) fx.event(e);
            if (e.type === 'rows') say(e.n === 1 ? 'Row!' : e.n + ' rows!', '#ffffff');
            else if (e.type === 'burst') say(e.n === 1 ? 'Burst ' + e.cells : e.n + ' bursts ' + e.cells, PALETTE[1]);
            else if (e.type === 'chain') say('Chain x' + e.n, PALETTE[0]);
            else if (e.type === 'spark') say(e.colour >= 0 ? 'Spark: all ' + NAMES[e.colour] + ' gone' : 'Spark +50', SPARK_COL);
            else if (e.type === 'level') say('Level ' + e.level + (e.level === 4 ? ': green joins' : ''), PALETTE[3]);
            else if (e.type === 'over' && !ended) {
                ended = true;
                if (api.end) api.end(eng.score);
            }
        }
    }

    function action(a) {
        if (eng.over() || paused) return;
        if (a === 'left') eng.move(-1);
        else if (a === 'right') eng.move(1);
        else if (a === 'rotate') eng.rotate();
        else if (a === 'swap') eng.swapColours();
        else if (a === 'drop') { if (eng.drop() && fx) fx.dropped(); }
        else if (a === 'down') eng.stepDown();
        handleEvents();
    }

    function hit(x, y) {
        for (const b of buttons) if (x >= b[1] && x < b[1] + b[3] && y >= b[2] && y < b[2] + b[4]) return b[0];
        if (x >= WX && x < WX + wellW && y >= WY && y < WY + wellH) return 'swap';
        return null;
    }

    function input(ev) {
        if (!ev) return;
        switch (ev.type) {
        case 'knob': {
            const d = Math.max(-4, Math.min(4, ev.delta | 0));
            if (d && !paused && !eng.over()) { eng.move(d); handleEvents(); }
            return;
        }
        case 'press': return action('rotate');
        case 'push': return action({ N: 'swap', S: 'drop', E: 'right', W: 'left' }[ev.dir]);
        case 'touch': {
            // act on the finger going down (quicker than the tap, which follows it on lifting)
            if (ev.phase !== 'down') return;
            const a = hit(ev.x, ev.y);
            if (a) { pressedBtn = a; pressedT = now; }
            return action(a);
        }
        case 'key': {
            const k = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'rotate', ArrowDown: 'down', ' ': 'drop', Enter: 'rotate', c: 'swap', C: 'swap', x: 'swap' }[ev.key];
            if (k) action(k);
            return;
        }
        default:   // 'tap' (handled as touch down), 'release'
        }
    }

    function update(dt) {
        now += dt;
        if (!paused) { eng.tick(dt); handleEvents(); if (fx) fx.update(dt); }
    }

    /* ---------- drawing ---------- */

    function cell(cv, x, y, colour, opts) {
        opts = opts || {};
        const s = opts.size || CELL, g = 2;
        if (colour === SPARK_ID) {
            // the Spark: a white cell with a glowing core (pulses)
            const p = 0.5 + 0.5 * Math.sin(now / 120);
            cv.roundRect(x + g, y + g, s - 2 * g, s - 2 * g, 8, alpha('#ffffff', 0.25 + 0.2 * p));
            cv.roundRect(x + s * 0.28, y + s * 0.28, s * 0.44, s * 0.44, 5, SPARK_COL);
            return;
        }
        const c = opts.flash ? '#ffffff' : PALETTE[colour];
        cv.roundRect(x + g, y + g, s - 2 * g, s - 2 * g, 7, shade(c, -0.35));
        cv.roundRect(x + g, y + g, s - 2 * g, s - 2 * g - 4, 7, c);
        cv.roundRect(x + g + 5, y + g + 4, s - 2 * g - 10, 5, 3, alpha('#ffffff', opts.flash ? 0.9 : 0.35));
    }

    function panel(cv, t, x, y, w, h) {
        cv.roundRect(x, y, w, h, 14, t.panelEdge);
        cv.roundRect(x + 2, y + 2, w - 4, h - 4, 12, t.panelTop);
    }

    // a triangle: the kit draws four-corner shapes, so one corner twice
    function tri(cv, p, c) { cv.quad([p[0], p[1], p[2], p[2]], c); }

    function arrow(cv, cx, cy, dir, c) {
        const s = 22;
        if (dir === 'L') tri(cv, [[cx - s, cy], [cx + s * 0.7, cy - s], [cx + s * 0.7, cy + s]], c);
        else if (dir === 'R') tri(cv, [[cx + s, cy], [cx - s * 0.7, cy - s], [cx - s * 0.7, cy + s]], c);
        else tri(cv, [[cx, cy + s], [cx - s, cy - s * 0.7], [cx + s, cy - s * 0.7]], c);
    }

    function rotateIcon(cv, cx, cy, c) {
        // a ring with a gap and an arrow head (drawn from arcs: the kit's arc takes degrees clockwise from 12)
        cv.arc(cx, cy, 15, 22, 40, 320, c);
        tri(cv, [[cx + 4, cy - 30], [cx + 4, cy - 6], [cx + 22, cy - 18]], c);
    }

    function drawButtons(cv, t) {
        for (const b of buttons) {
            const down = pressedBtn === b[0] && now - pressedT < 140;
            const [id, x, y, w, h, label] = b;
            cv.roundRect(x, y, w, h, 16, down ? t.accent2 : t.panelEdge);
            cv.roundRect(x + 2, y + 2, w - 4, h - 4, 14, down ? shade(String(t.accent2).slice(0, 7), -0.5) : t.track);
            const cx = x + w / 2, cy = y + h / 2 - 14, ic = t.text;
            if (id === 'left') arrow(cv, cx, cy, 'L', ic);
            else if (id === 'right') arrow(cv, cx, cy, 'R', ic);
            else if (id === 'drop') arrow(cv, cx, cy, 'D', ic);
            else rotateIcon(cv, cx, cy, ic);
            cv.text(label, cx, y + h - 22, 24, t.dim, { align: 'center', font: 'bold' });
        }
    }

    function drawWell(cv, t) {
        cv.roundRect(WX - 8, WY - 8, wellW + 16, wellH + 16, 12, t.panelEdge);
        cv.fillRect(WX, WY, wellW, wellH, '#000000');
        for (let c = 1; c < cols; c++) cv.fillRect(WX + c * CELL, WY, 1, wellH, alpha('#ffffff', 0.05));
        for (let r = 1; r < rows; r++) cv.fillRect(WX, WY + r * CELL, wellW, 1, alpha('#ffffff', 0.05));

        const marked = {};
        if (eng.marked) eng.marked.forEach((m) => { marked[m[1] * cols + m[0]] = true; });
        const blink = eng.phase === 'clear' && Math.floor(eng.timer / 80) % 2 === 0;
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
            const v = eng.board[r][c];
            if (v < 0) continue;
            cell(cv, WX + c * CELL, WY + r * CELL, v, { flash: marked[r * cols + c] && blink });
        }
        // ghost: where the shard lands
        for (const g of eng.ghostCells()) {
            if (g[1] < 0) continue;
            const col = g[2] === SPARK_ID ? SPARK_COL : PALETTE[g[2]];
            cv.strokeRoundRect(WX + g[0] * CELL + 4, WY + g[1] * CELL + 4, CELL - 8, CELL - 8, 6, 2, alpha(col, 0.55));
        }
        for (const p of eng.pieceCells()) {
            if (p[1] < 0) continue;
            cell(cv, WX + p[0] * CELL, WY + p[1] * CELL, p[2]);
        }
    }

    function drawShard(cv, kind, colours, cx, cy, size) {
        const cells = engine.SHAPES[kind].cells;
        let x0 = 9, x1 = -9, y0 = 9, y1 = -9;
        cells.forEach((c) => { x0 = Math.min(x0, c[0]); x1 = Math.max(x1, c[0]); y0 = Math.min(y0, c[1]); y1 = Math.max(y1, c[1]); });
        const ox = cx - ((x1 - x0 + 1) * size) / 2, oy = cy - ((y1 - y0 + 1) * size) / 2;
        cells.forEach((c, i) => cell(cv, ox + (c[0] - x0) * size, oy + (c[1] - y0) * size, colours[i], { size }));
    }

    function icon(cv, id, cx, cy, c) {
        if (id === 'left') arrow(cv, cx, cy, 'L', c);
        else if (id === 'right') arrow(cv, cx, cy, 'R', c);
        else if (id === 'drop') arrow(cv, cx, cy, 'D', c);
        else rotateIcon(cv, cx, cy, c);
    }

    if (api.style && look) {
        fx = look.makeLook(api.style, {
            eng, engine, W, H, CELL, WX, WY, cols, rows, buttons, BTN_Y, best, icon,
            now: () => now, state: () => ({ now, paused, pressedBtn, pressedT }),
        });
    }

    function draw(cv) {
        if (fx) return fx.draw(cv);
        // the shell clears the frame to the theme's background
        const t = Object.assign({}, DEFAULT_THEME, (api.theme && api.theme()) || {});
        for (const k of ['panelTop', 'panelEdge', 'track', 'accent2', 'text', 'dim', 'crit']) if (typeof t[k] !== 'string') t[k] = DEFAULT_THEME[k];

        // left: score
        const LX = 16, LW = WX - 40 - LX;
        panel(cv, t, LX, 48, LW, BTN_Y - 48 - 14);
        cv.text('BLOCK DROP', LX + 28, 84, 26, t.accent2, { font: 'bold', spacing: 3 });
        cv.text('SCORE', LX + 28, 124, 20, t.dim, { font: 'bold', spacing: 2 });
        cv.text(String(eng.score), LX + 28, 186, 64, t.text, { font: 'num', literal: true });
        cv.text('LEVEL', LX + 28, 230, 20, t.dim, { font: 'bold', spacing: 2 });
        cv.text(String(eng.level), LX + 28, 270, 40, t.text, { font: 'num', literal: true });
        cv.text('BEST', LX + 200, 230, 20, t.dim, { font: 'bold', spacing: 2 });
        cv.text(String(Math.max(best, eng.score)), LX + 200, 270, 40, eng.score > best ? PALETTE[3] : t.text, { font: 'num', literal: true });
        cv.text('ROWS ' + eng.lines + '   BURSTS ' + eng.bursts, LX + 28, 316, 18, t.dim, { font: 'bold', spacing: 1, literal: true });

        // right: next shard + the rules in one line each
        const RX = WX + wellW + 40, RW = W - 16 - RX;
        panel(cv, t, RX, 48, RW, BTN_Y - 48 - 14);
        cv.text('NEXT', RX + 28, 84, 20, t.dim, { font: 'bold', spacing: 2 });
        cv.roundRect(RX + 24, 98, 150, 110, 10, '#000000');
        drawShard(cv, eng.next.kind, eng.next.colours, RX + 24 + 75, 98 + 55, 34);
        const tips = ['Fill a row to clear it', 'Join 4 of one colour: burst', 'Spark wipes the colour below', 'Tap the well: swap colours'];
        tips.forEach((s, i) => cv.text(s, RX + 196, 110 + i * 30, 19, t.dim, { literal: false }));
        cv.text('Knob: turn move, press rotate, up swap, down drop', RX + 28, 318, 17, t.dim, {});

        drawWell(cv, t);
        drawButtons(cv, t);

        // the latest clear, in the right panel's free space (fades out)
        flash = flash.filter((f) => now - f.t < 1600);
        const shown = flash.slice(-2);
        shown.forEach((f, i) => {
            const a = Math.min(1, 2 * (1 - (now - f.t) / 1600));
            const older = shown.length > 1 && i === 0;      // the one before: smaller, above
            cv.text(f.text, RX + 28, older ? 240 : 284, older ? 26 : 36, alpha(f.colour, a), { font: 'bold', literal: true });
        });

        // the shell shows the result card after end(); here the well only dims
        if (eng.over() || paused) {
            cv.fillRect(WX, WY, wellW, wellH, alpha('#000000', 0.65));
            if (paused) cv.text('PAUSED', WX + wellW / 2, WY + wellH / 2, 40, t.text, { align: 'center', font: 'bold', spacing: 2 });
        }
        return cv;
    }

    return {
        update,
        input,
        draw,
        pause() { paused = true; },
        resume() { paused = false; },
        // for tests and the dev preview
        state: () => ({ score: eng.score, level: eng.level, over: eng.over(), paused }),
        engine: eng,
    };
}

module.exports = {
    id: 'block-drop',
    title: 'Block Drop',
    blurb: 'Rows or 4 of a colour clear',
    order: 70,
    needs: [],
    score: { unit: 'pts', lower: false },
    art: look ? look.art : undefined,
    create,
};
