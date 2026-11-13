'use strict';
/**
 * Block Drop - game rules, no drawing (engine.js).
 *
 * Our own falling-blocks puzzle. Pieces ("shards") are 1 to 3 cells, and every cell has its own
 * colour. A cell clears in two ways:
 *   - a FULL ROW clears (every cell in it), and
 *   - a GROUP of 4 or more cells of one colour, touching side by side, BURSTS.
 * After a clear every loose cell falls straight down on its own (no floating blocks), which can
 * make new rows and groups: each further clear in the same drop is a CHAIN and scores more.
 *
 * Shards:  Bar (3 in a line), Hook (3 in an L), Pair (2), and now and then a Spark (1 white cell):
 * where a Spark lands it wipes every cell of the colour it lands on.
 *
 * Controls (any input maps onto these): left / right, rotate, swap colours (the colours move round
 * the shard's cells), drop (straight down and lock).
 *
 * Pure JavaScript for Node 8 (the head unit) and browsers: no dependencies, no timers. The host
 * calls tick(dtMs) every frame.
 */

const COLS = 10;
const ROWS = 12;
const SPARK = 9;                 // colour id of the Spark cell
const LOCK_MS = 450;             // a shard resting on something locks after this long
const LOCK_RESETS = 10;          // moves / turns that restart the lock time (then it locks anyway)
const CLEAR_MS = 320;            // how long cleared cells flash before they go
const SETTLE_MS = 90;            // pause after cells drop, before the next chain step is looked at
const CELLS_PER_LEVEL = 36;      // cleared cells for the next level
const FOUR_COLOURS_AT = 4;       // from this level a fourth colour joins
const SPARK_EVERY = 22;          // on average one Spark in this many shards
const BURST_MIN = 4;

// shapes as [col, row] offsets; cell 0 or 1 is the turning point
const SHAPES = {
    bar:  { cells: [[-1, 0], [0, 0], [1, 0]], pivot: 1 },
    hook: { cells: [[0, -1], [0, 0], [1, 0]], pivot: 1 },
    pair: { cells: [[0, 0], [1, 0]], pivot: 0 },
    spark: { cells: [[0, 0]], pivot: 0 },
};
const KINDS = ['bar', 'bar', 'hook', 'hook', 'hook', 'pair', 'pair'];

/** Small seeded random numbers (mulberry32): the same seed plays the same shards (tests). */
function rng(seed) {
    let a = (seed >>> 0) || 1;
    return function () {
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function gravityMs(level) { return Math.max(110, 820 - (level - 1) * 65); }

class BlockDrop {
    /** opts: { seed, cols, rows } */
    constructor(opts) {
        opts = opts || {};
        this.cols = opts.cols || COLS;
        this.rows = opts.rows || ROWS;
        this.seed = opts.seed != null ? opts.seed : Date.now();
        this.reset(this.seed);
    }

    reset(seed) {
        if (seed != null) this.seed = seed;
        this.rand = rng(this.seed);
        this.board = [];
        for (let r = 0; r < this.rows; r++) this.board.push(new Array(this.cols).fill(-1));
        this.score = 0;
        this.level = 1;
        this.cleared = 0;            // cells cleared in all
        this.lines = 0;              // full rows cleared
        this.bursts = 0;             // colour groups burst
        this.bestChain = 0;
        this.phase = 'fall';         // fall | clear | settle | over
        this.timer = 0;              // ms into the current phase / fall step
        this.lockT = 0; this.lockN = 0;
        this.marked = null;          // cells flashing in 'clear': [[c, r], ...]
        this.chain = 0;
        this.events = [];            // for the screen: { type: 'rows'|'burst'|'spark'|'chain'|'level'|'over', ... }
        this.sinceSpark = 0;
        this.next = this._make();
        this._spawn();
    }

    colours() { return this.level >= FOUR_COLOURS_AT ? 4 : 3; }

    _make() {
        this.sinceSpark++;
        const sparkChance = this.sinceSpark > 8 ? 1 / SPARK_EVERY : 0;
        if (this.rand() < sparkChance || this.sinceSpark > SPARK_EVERY * 2) {
            this.sinceSpark = 0;
            return { kind: 'spark', colours: [SPARK] };
        }
        const kind = KINDS[Math.floor(this.rand() * KINDS.length)];
        const n = SHAPES[kind].cells.length, k = this.colours();
        const colours = [];
        for (let i = 0; i < n; i++) colours.push(Math.floor(this.rand() * k));
        return { kind, colours };
    }

    _spawn() {
        const p = this.next;
        this.next = this._make();
        this.piece = {
            kind: p.kind, colours: p.colours.slice(),
            cells: SHAPES[p.kind].cells.map((c) => c.slice()),
            col: Math.floor(this.cols / 2) - 1, row: 1,
        };
        // a hook points up from row 0; everything else starts in row 0 (row 1 for the hook's base)
        if (p.kind !== 'hook') this.piece.row = 0;
        this.lockT = 0; this.lockN = 0; this.timer = 0;
        if (!this._fits(this.piece.cells, this.piece.col, this.piece.row)) {
            this.phase = 'over';
            this.events.push({ type: 'over', score: this.score });
        }
    }

    /** Cells of the falling shard on the board: [[col, row, colour], ...]. */
    pieceCells(p) {
        p = p || this.piece;
        if (!p) return [];
        return p.cells.map((c, i) => [p.col + c[0], p.row + c[1], p.colours[i]]);
    }

    /** Where the shard would land: its cells. */
    ghostCells() {
        if (this.phase !== 'fall') return [];
        const p = this.piece;
        let r = p.row;
        while (this._fits(p.cells, p.col, r + 1)) r++;
        return p.cells.map((c, i) => [p.col + c[0], r + c[1], p.colours[i]]);
    }

    _fits(cells, col, row) {
        for (const c of cells) {
            const x = col + c[0], y = row + c[1];
            if (x < 0 || x >= this.cols || y >= this.rows) return false;
            if (y >= 0 && this.board[y][x] !== -1) return false;
        }
        return true;
    }

    _grounded() { return !this._fits(this.piece.cells, this.piece.col, this.piece.row + 1); }

    _moved() {
        // moving a resting shard restarts its lock time, a few times
        if (this._grounded() && this.lockN < LOCK_RESETS) { this.lockT = 0; this.lockN++; }
    }

    /* ---------- moves: each returns true when it did something ---------- */

    move(dx) {
        if (this.phase !== 'fall' || !dx) return false;
        const step = dx > 0 ? 1 : -1;
        let done = false;
        for (let i = 0; i < Math.abs(dx); i++) {
            if (!this._fits(this.piece.cells, this.piece.col + step, this.piece.row)) break;
            this.piece.col += step; done = true;
        }
        if (done) this._moved();
        return done;
    }

    rotate() {
        if (this.phase !== 'fall') return false;
        const p = this.piece;
        if (p.kind === 'spark') return false;
        const pv = p.cells[SHAPES[p.kind].pivot];
        // clockwise on screen (rows grow downwards): (x, y) -> (-y, x) around the pivot
        const turned = p.cells.map((c) => [pv[0] - (c[1] - pv[1]), pv[1] + (c[0] - pv[0])]);
        const kicks = [[0, 0], [-1, 0], [1, 0], [0, -1], [-2, 0], [2, 0]];
        for (const k of kicks) {
            if (this._fits(turned, p.col + k[0], p.row + k[1])) {
                p.cells = turned; p.col += k[0]; p.row += k[1];
                this._moved();
                return true;
            }
        }
        return false;
    }

    /** The colours move one cell along the shard (the last cell's colour goes to the first). */
    swapColours() {
        if (this.phase !== 'fall') return false;
        const c = this.piece.colours;
        if (c.length < 2) return false;
        c.unshift(c.pop());
        this._moved();
        return true;
    }

    /** Straight down and lock now. */
    drop() {
        if (this.phase !== 'fall') return false;
        let n = 0;
        while (this._fits(this.piece.cells, this.piece.col, this.piece.row + 1)) { this.piece.row++; n++; }
        this.score += n * 2;
        this._lock();
        return true;
    }

    /** One row down now (a soft drop); locks when it can't. */
    stepDown() {
        if (this.phase !== 'fall') return false;
        if (this._fits(this.piece.cells, this.piece.col, this.piece.row + 1)) {
            this.piece.row++; this.score += 1; this.timer = 0;
            return true;
        }
        this._lock();
        return true;
    }

    /* ---------- time ---------- */

    tick(dt) {
        if (!(dt > 0)) return;
        dt = Math.min(dt, 250);              // a long gap (the app was hidden) is not a free fall
        if (this.phase === 'fall') {
            if (this._grounded()) {
                this.lockT += dt;
                if (this.lockT >= LOCK_MS) this._lock();
                return;
            }
            this.lockT = 0;
            this.timer += dt;
            const g = gravityMs(this.level);
            while (this.timer >= g && this.phase === 'fall') {
                this.timer -= g;
                if (this._fits(this.piece.cells, this.piece.col, this.piece.row + 1)) this.piece.row++;
                else break;
            }
        } else if (this.phase === 'clear') {
            this.timer += dt;
            if (this.timer >= CLEAR_MS) this._removeMarked();
        } else if (this.phase === 'settle') {
            this.timer += dt;
            if (this.timer >= SETTLE_MS) this._resolve();
        }
    }

    /* ---------- locking and clearing ---------- */

    _lock() {
        const cells = this.pieceCells();
        this.piece = null;
        let spark = null;
        for (const c of cells) {
            if (c[1] < 0) continue;              // above the top: lost (the game ends at the next spawn)
            if (c[2] === SPARK) spark = c;
            else this.board[c[1]][c[0]] = c[2];
        }
        this.chain = 0;
        if (spark) {
            const under = spark[1] + 1 < this.rows ? this.board[spark[1] + 1][spark[0]] : -1;
            if (under >= 0) {
                const hit = [];
                for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) if (this.board[r][c] === under) hit.push([c, r]);
                this.events.push({ type: 'spark', colour: under, cells: hit.length });
                this._mark(hit, hit.length * 15 * this.level);
                return;
            }
            // landed on the floor: no colour under it, a small bonus
            this.score += 50 * this.level;
            this.events.push({ type: 'spark', colour: -1, cells: 0 });
        }
        this._resolve();
    }

    /** Look for full rows and colour groups; mark them, or carry on with the next shard. */
    _resolve() {
        const marks = new Set(), rows = [];
        for (let r = 0; r < this.rows; r++) {
            if (this.board[r].every((v) => v !== -1)) {
                rows.push(r);
                for (let c = 0; c < this.cols; c++) marks.add(r * this.cols + c);
            }
        }
        const groups = this.groups(BURST_MIN);
        groups.forEach((g) => g.forEach((i) => marks.add(i)));
        if (!marks.size) {
            if (this.chain > this.bestChain) this.bestChain = this.chain;
            this.phase = 'fall';
            this._spawn();
            return;
        }
        this.chain++;
        const mult = this.chain;
        const groupCells = groups.reduce((a, g) => a + g.length, 0);
        // rows: 100, 300, 600, 1000 for 1-4 at once; groups: 10 a cell, plus 20 a cell over the minimum
        const rowPts = [0, 100, 300, 600, 1000][Math.min(rows.length, 4)] + Math.max(0, rows.length - 4) * 400;
        const groupPts = groups.reduce((a, g) => a + g.length * 10 + (g.length - BURST_MIN) * 20, 0);
        const pts = (rowPts + groupPts) * this.level * mult;
        if (rows.length) { this.lines += rows.length; this.events.push({ type: 'rows', n: rows.length, rows }); }
        if (groups.length) { this.bursts += groups.length; this.events.push({ type: 'burst', n: groups.length, cells: groupCells }); }
        if (this.chain > 1) this.events.push({ type: 'chain', n: this.chain });
        const list = [];
        marks.forEach((i) => list.push([i % this.cols, Math.floor(i / this.cols)]));
        this._mark(list, pts);
    }

    _mark(cells, pts) {
        this.marked = cells;
        this.score += pts;
        this.phase = 'clear';
        this.timer = 0;
        if (!cells.length) { this._removeMarked(); }
    }

    _removeMarked() {
        for (const c of this.marked) this.board[c[1]][c[0]] = -1;
        const before = this.level;
        this.cleared += this.marked.length;
        this.level = 1 + Math.floor(this.cleared / CELLS_PER_LEVEL);
        if (this.level > before) this.events.push({ type: 'level', level: this.level });
        this.marked = null;
        this._fall();
        this.phase = 'settle';
        this.timer = 0;
    }

    /** Every cell falls straight down as far as it can (column by column). */
    _fall() {
        for (let c = 0; c < this.cols; c++) {
            let w = this.rows - 1;
            for (let r = this.rows - 1; r >= 0; r--) {
                const v = this.board[r][c];
                if (v !== -1) { this.board[r][c] = -1; this.board[w][c] = v; w--; }
            }
        }
    }

    /** Groups of at least `min` same-coloured cells touching side by side: arrays of r * cols + c. */
    groups(min) {
        const seen = new Uint8Array(this.rows * this.cols), out = [];
        for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) {
            const v = this.board[r][c], i0 = r * this.cols + c;
            if (v < 0 || seen[i0]) continue;
            const stack = [i0], g = [];
            seen[i0] = 1;
            while (stack.length) {
                const i = stack.pop(), x = i % this.cols, y = (i - x) / this.cols;
                g.push(i);
                const nb = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
                for (const n of nb) {
                    if (n[0] < 0 || n[0] >= this.cols || n[1] < 0 || n[1] >= this.rows) continue;
                    const j = n[1] * this.cols + n[0];
                    if (!seen[j] && this.board[n[1]][n[0]] === v) { seen[j] = 1; stack.push(j); }
                }
            }
            if (g.length >= min) out.push(g);
        }
        return out;
    }

    /** Events since the last call (for sounds / messages on screen). */
    takeEvents() { const e = this.events; this.events = []; return e; }

    over() { return this.phase === 'over'; }
}

module.exports = { BlockDrop, COLS, ROWS, SPARK, SHAPES, gravityMs, rng, BURST_MIN, CELLS_PER_LEVEL };
