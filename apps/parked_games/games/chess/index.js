'use strict';
/**
 * Chess - a Parked Games game (interface: apps/parked_games/GAMES.md).
 *
 * Play the computer (Easy, Medium or Hard), or a friend in the car: one of you plays with the
 * iDrive knob, the other on the touchscreen (choose which side the knob gets).
 *
 * Knob: turn to go through the pieces that can move (and the Take back / Resign buttons), press
 * to pick one up, turn through its moves, press to play it. Pushing the controller moves the
 * cursor square by square. Touch: tap a piece, then tap where it goes, or drag it there.
 *
 * Rules and the engine: engine.js. Picture: look.js. Tests: node apps/parked_games/games/chess/test.js
 * A game in progress is saved after every move, so it survives the car being switched off.
 */
const E = require('./engine');
const look = require('./look');
const L = look.LAYOUT;

const SLICE = 2000;              // engine nodes per frame (a few ms on the car)
const MIN_THINK = 450;           // ms the computer seems to think at least
const ANIM = 220;                // ms a move slides
const END_HOLD = 2600;           // ms the final position shows before the result card
const LEVEL_IDS = ['easy', 'medium', 'hard'];

class Game {
    constructor(api) {
        this.api = api;
        this.S = api.style;
        this.fx = new look.Fx(this.S);
        const prefs = (api.store && api.store.get('prefs')) || {};
        this.prefs = {
            mode: prefs.mode === 'friend' ? 'friend' : 'computer',
            level: LEVEL_IDS.indexOf(prefs.level) >= 0 ? prefs.level : 'easy',
            human: prefs.human === 1 ? 1 : 0,              // the side you play against the computer
            knobSide: prefs.knobSide === 1 ? 1 : 0,        // the side the knob plays in a two-player game
        };
        const saved = api.store && api.store.get('game');
        this.saved = saved && Array.isArray(saved.moves) ? saved : null;
        this.state = 'setup';
        this.b = new E.Board();
        this.tt = E.Search.table();
        this.setupRow = 0;              // Continue (a saved game), else the opponent: a stray press can't start a game
        this.sel = -1;                 // the square of the picked-up piece
        this.cursor = { kind: 'sq', sq: E.sqOf('e2') };
        this.promo = null;             // { from, to, moves, i, device }
        this.anim = null;
        this.think = null;             // { search, t }
        this.drag = null;              // { from, x, y, moved, wasSel, device }
        this.down = null;              // where the finger went down
        this.confirm = null;           // { what: 'resign', device, t }
        this.result = null;            // the board's status when the game is over
        this.ended = false;
        this.t = 0;
        this.paused = false;
        this.sans = [];                // the moves played, in SAN
        this.flash = null;             // a short message: { s, t }
        this.status = this.b.status();
    }

    /* ---------- the setup screen ---------- */
    setupRows() {
        const rows = [];
        if (this.saved) rows.push('continue');
        rows.push('mode');
        if (this.prefs.mode === 'computer') rows.push('level', 'human'); else rows.push('knobSide');
        rows.push('start');
        return rows;
    }
    setupChoices(row) {
        const p = this.prefs;
        if (row === 'mode') return { label: 'Opponent', opts: ['Computer', '2 players'], i: p.mode === 'friend' ? 1 : 0 };
        if (row === 'level') return { label: 'Level', opts: ['Easy', 'Medium', 'Hard'], i: LEVEL_IDS.indexOf(p.level) };
        if (row === 'human') return { label: 'You play', opts: ['White', 'Black'], i: p.human };
        if (row === 'knobSide') return { label: 'Knob plays', opts: ['White', 'Black'], i: p.knobSide, note: 'touch plays ' + (p.knobSide ? 'White' : 'Black') };
        return null;
    }
    setChoice(row, i) {
        const p = this.prefs;
        if (row === 'mode') p.mode = i === 1 ? 'friend' : 'computer';
        else if (row === 'level') p.level = LEVEL_IDS[(i + 3) % 3];
        else if (row === 'human') p.human = i & 1;
        else if (row === 'knobSide') p.knobSide = i & 1;
        const rows = this.setupRows();
        if (row === 'mode') this.setupRow = rows.indexOf('mode');
        this.setupRow = Math.max(0, Math.min(rows.length - 1, this.setupRow));
    }
    setupInput(ev) {
        const rows = this.setupRows();
        if (ev.type === 'knob') { this.setupRow = Math.max(0, Math.min(rows.length - 1, this.setupRow + ev.delta)); return; }
        if (ev.type === 'push' && (ev.dir === 'N' || ev.dir === 'S')) { this.setupRow = Math.max(0, Math.min(rows.length - 1, this.setupRow + (ev.dir === 'S' ? 1 : -1))); return; }
        const row = rows[this.setupRow], ch = this.setupChoices(row);
        if (ev.type === 'push' && ch) { const n = ch.opts.length; this.setChoice(row, (ch.i + (ev.dir === 'E' ? 1 : -1) + n) % n); return; }
        if (ev.type === 'press') {
            if (row === 'start') this.start(null);
            else if (row === 'continue') this.start(this.saved);
            else if (ch) this.setChoice(row, (ch.i + 1) % ch.opts.length);
            return;
        }
        if (ev.type === 'touch' && ev.phase === 'up') {
            const hit = look.setupHit(this, ev.x, ev.y);
            if (!hit) return;
            this.setupRow = this.setupRows().indexOf(hit.row);
            if (hit.row === 'start') this.start(null);
            else if (hit.row === 'continue') this.start(this.saved);
            else if (hit.opt >= 0) this.setChoice(hit.row, hit.opt);
        }
    }
    start(saved) {
        if (saved) {
            this.prefs.mode = saved.mode === 'friend' ? 'friend' : 'computer';
            if (LEVEL_IDS.indexOf(saved.level) >= 0) this.prefs.level = saved.level;
            this.prefs.human = saved.human === 1 ? 1 : 0;
            this.prefs.knobSide = saved.knobSide === 1 ? 1 : 0;
        }
        if (this.api.store) this.api.store.set('prefs', this.prefs);
        this.mode = this.prefs.mode;
        this.level = E.LEVELS[this.prefs.level];
        this.human = this.prefs.human;
        this.knobSide = this.prefs.knobSide;
        this.b = new E.Board();
        this.sans = [];
        if (saved) {
            for (const u of saved.moves) {
                const m = this.b.fromUci(u);
                if (!m) break;
                this.sans.push(this.b.san(m));
                this.b.make(m);
            }
        }
        this.saved = null;
        this.state = 'play';
        this.flip = this.mode === 'computer' && this.human === 1;      // the player's side at the bottom
        this.sel = -1; this.promo = null; this.anim = null; this.think = null; this.drag = null; this.confirm = null;
        this.result = null;
        this.status = this.b.status();
        this.cursor = { kind: 'sq', sq: this.b.side ? E.sqOf('e7') : E.sqOf('e2') };
        this.fx.newGame();
        this.after();
    }

    /* ---------- whose turn, and with what ---------- */
    /** The side a device plays: the knob or touch. Against the computer both play yours. */
    sideOf(device) {
        if (this.mode === 'computer') return this.human;
        return device === 'knob' ? this.knobSide : this.knobSide ^ 1;
    }
    computerToMove() { return this.mode === 'computer' && this.b.side !== this.human; }
    canMove(device) {
        return this.state === 'play' && !this.result && !this.anim && !this.computerToMove() && this.sideOf(device) === this.b.side;
    }
    /** The legal moves from a square. */
    movesFrom(sq) { return (this.status.moves || []).filter((m) => E.mFrom(m) === sq); }
    movable() {
        const seen = {}, out = [];
        (this.status.moves || []).forEach((m) => { const f = E.mFrom(m); if (!seen[f]) { seen[f] = 1; out.push(f); } });
        return this.sortSquares(out);
    }
    /** Squares in reading order from the bottom-left of the screen (the knob's turning order). */
    sortSquares(list) {
        const key = (s) => { const v = look.view(this, s); return v.row * -8 + v.col; };   // bottom row first, left to right
        return list.slice().sort((x, y) => key(x) - key(y));
    }
    buttons() {
        if (this.result) return this.mode === 'friend' ? ['new'] : [];
        return ['undo', 'resign'];
    }
    knobItems() {
        const items = [];
        if (this.promo) return this.promo.moves.map((m, i) => ({ kind: 'promo', i }));
        if (this.canMove('knob')) {
            if (this.sel >= 0) {
                items.push({ kind: 'sq', sq: this.sel });
                this.sortSquares(this.movesFrom(this.sel).map(E.mTo).filter((s, i, a) => a.indexOf(s) === i)).forEach((sq) => items.push({ kind: 'sq', sq }));
                return items;
            }
            this.movable().forEach((sq) => items.push({ kind: 'sq', sq }));
        }
        this.buttons().forEach((id) => items.push({ kind: 'btn', id }));
        return items;
    }

    /* ---------- moves ---------- */
    /** The player picks a destination for the picked-up piece. */
    tryMove(to, device) {
        const ms = this.movesFrom(this.sel).filter((m) => E.mTo(m) === to);
        if (!ms.length) return false;
        if (ms.length > 1) {          // a promotion: which piece?
            const order = [E.QUEEN, E.ROOK, E.BISHOP, E.KNIGHT];
            this.promo = { from: this.sel, to, moves: order.map((t) => ms.find((m) => E.mPromo(m) === t)), i: 0, device };
            if (device === 'knob') this.cursor = { kind: 'promo', i: 0 };
            return true;
        }
        this.doMove(ms[0]);
        return true;
    }
    doMove(m) {
        const b = this.b, from = E.mFrom(m), to = E.mTo(m), piece = b.sq[from];
        this.sans.push(b.san(m));
        const capSq = E.mFlags(m) & E.F_EP ? to + (b.side ? 16 : -16) : to;
        const captured = b.sq[capSq];
        b.make(m);
        this.anim = { m, piece, from, to, t: 0, captured, capSq, castle: (E.mFlags(m) & E.F_CASTLE) !== 0 };
        this.sel = -1; this.promo = null; this.drag = null; this.confirm = null;
        this.fx.moved(this, this.anim);
        this.status = b.status();
        this.save();
    }
    /** After a move (or at the start): the result, or the next player's cursor. */
    after() {
        const st = this.status;
        if (st.over) {
            this.result = st;
            this.endT = 0;
            this.save();
            this.fx.over(this, st);
            return;
        }
        if (this.computerToMove()) { this.think = { search: new E.Search(this.b, this.level, this.api.random, this.tt), t: 0 }; return; }
        // the knob's cursor starts on a piece that can move, near where it was
        if (this.canMove('knob')) {
            const ms = this.movable();
            if (ms.length && !(this.cursor.kind === 'sq' && ms.indexOf(this.cursor.sq) >= 0)) {
                const at = this.cursor.kind === 'sq' ? this.cursor.sq : E.sqOf('e2');
                const d = (s) => Math.abs((s & 7) - (at & 7)) + Math.abs((s >> 4) - (at >> 4));
                this.cursor = { kind: 'sq', sq: ms.slice().sort((x, y) => d(x) - d(y))[0] };
            }
        }
    }
    undo() {
        if (this.state !== 'play' || this.anim) return;
        if (this.result && this.mode === 'computer') return;
        this.think = null;
        // against the computer, take back to your own move; with a friend, one move
        let n = this.mode === 'computer' ? (this.b.side === this.human ? 2 : 1) : 1;
        n = Math.min(n, this.b.ply);
        if (this.mode === 'computer' && this.b.ply - n < 0) n = this.b.ply;
        if (!n) { this.note('Nothing to take back'); return; }
        for (let i = 0; i < n; i++) { this.b.undo(); this.sans.pop(); }
        this.sel = -1; this.promo = null; this.result = null; this.confirm = null;
        this.status = this.b.status();
        this.save();
        this.note('Taken back');
        this.after();
    }
    resign(device) {
        if (this.state !== 'play' || this.result) return;
        const side = this.sideOf(device);
        this.think = null; this.sel = -1; this.promo = null; this.confirm = null;
        this.result = { over: true, why: 'resign', winner: side ^ 1, result: side ? '1-0' : '0-1', check: false };
        this.endT = 0;
        this.save();
        this.fx.over(this, this.result);
    }
    button(id, device) {
        if (id === 'undo') this.undo();
        else if (id === 'resign') {
            if (this.confirm && this.confirm.what === 'resign' && this.confirm.device === device) this.resign(device);
            else this.confirm = { what: 'resign', device, t: 0 };
        } else if (id === 'new') { this.state = 'setup'; this.result = null; this.saved = null; this.setupRow = this.setupRows().indexOf('start'); this.b = new E.Board(); this.status = this.b.status(); this.sans = []; }
    }
    note(s) { this.flash = { s, t: 0 }; }
    save() {
        if (!this.api.store) return;
        if (this.result) { this.api.store.set('game', null); return; }
        const moves = this.b.hist.map((h) => h.m);
        // replay from the start to write the moves out (uci needs each position)
        const b = new E.Board(), out = [];
        for (const m of moves) { out.push(b.uci(m)); b.make(m); }
        this.api.store.set('game', { mode: this.mode, level: this.level ? this.level.id : 'easy', human: this.human, knobSide: this.knobSide, moves: out });
    }
    /** The score for the shell's high scores (games against the computer): a win counts the level, and more when it was quick. */
    score() {
        const r = this.result;
        if (!r) return 0;
        const pts = this.level.points, moves = Math.ceil(this.b.ply / 2);
        if (r.winner === this.human) return pts + Math.max(0, 100 - moves * 2);
        if (r.winner === -1) return Math.round(pts / 4);
        return 0;
    }

    /* ---------- the frame ---------- */
    update(dt) {
        this.t += dt;
        this.fx.update(dt, this);
        if (this.flash && (this.flash.t += dt) > 1600) this.flash = null;
        if (this.confirm && (this.confirm.t += dt) > 3000) this.confirm = null;
        if (this.state !== 'play') return;
        if (this.anim) {
            this.anim.t += dt;
            if (this.anim.t >= ANIM) { this.anim = null; this.after(); }
            return;
        }
        if (this.think) {
            this.think.t += dt;
            const s = this.think.search;
            if (s.step(SLICE) && this.think.t >= MIN_THINK) {
                this.think = null;
                if (s.best) this.doMove(s.best);
            }
            return;
        }
        if (this.result) {
            this.endT += dt;
            if (this.mode === 'computer' && !this.ended && this.endT >= END_HOLD) { this.ended = true; this.api.end(this.score()); }
        }
    }
    draw(cv) { look.draw(cv, this, this.S); }

    input(ev) {
        if (this.paused) return;
        if (ev.type === 'tap') return;               // touch comes as down / move / up (a tap is also sent as those)
        if (this.state === 'setup') { this.setupInput(ev); return; }
        if (ev.type === 'touch') { this.touch(ev); return; }
        this.knob(ev);
    }

    /* ---------- the knob ---------- */
    knob(ev) {
        const items = this.knobItems();
        if (ev.type === 'knob') {
            if (!items.length) { if (this.mode === 'friend' && !this.result) this.note((this.b.side ? 'Black' : 'White') + ' plays by touch'); return; }
            const n = items.length, up = ev.delta > 0;
            let i = this.itemIndex(items);
            if (i >= 0) i = ((i + (up ? 1 : -1)) % n + n) % n;
            else i = this.nearItem(items, up);
            this.cursor = items[i];
            if (this.cursor.kind === 'promo') this.promo.i = this.cursor.i;
            return;
        }
        if (ev.type === 'push') {
            if (this.promo) { const n = this.promo.moves.length, d = ev.dir === 'E' || ev.dir === 'S' ? 1 : -1; this.promo.i = (this.promo.i + d + n) % n; this.cursor = { kind: 'promo', i: this.promo.i }; return; }
            this.pushCursor(ev.dir);
            return;
        }
        if (ev.type !== 'press') return;
        const c = this.cursor;
        if (this.promo) {
            if (this.promo.device !== 'knob' && !this.canMove('knob')) return;
            this.doMove(this.promo.moves[this.promo.i]);
            return;
        }
        if (c.kind === 'btn') { this.button(c.id, 'knob'); return; }
        if (!this.canMove('knob')) { if (this.mode === 'friend' && !this.result) this.note((this.b.side ? 'Black' : 'White') + ' plays by touch'); return; }
        this.choose(c.sq, 'knob');
    }
    itemIndex(items) {
        const c = this.cursor;
        for (let i = 0; i < items.length; i++) {
            const it = items[i];
            if (it.kind !== c.kind) continue;
            if ((it.kind === 'sq' && it.sq === c.sq) || (it.kind === 'btn' && it.id === c.id) || (it.kind === 'promo' && it.i === c.i)) return i;
        }
        return -1;
    }
    /** The cursor is on a free square (after pushes): the next item in turning order after it, or the one before. */
    nearItem(items, up) {
        const c = this.cursor;
        if (c.kind !== 'sq') return up ? 0 : items.length - 1;
        const key = (s) => { const v = look.view(this, s); return v.row * -8 + v.col; }, k = key(c.sq);
        const sqs = [];
        items.forEach((it, i) => { if (it.kind === 'sq') sqs.push(i); });
        if (up) { for (const i of sqs) if (key(items[i].sq) > k) return i; return sqs.length ? sqs[0] : 0; }
        for (let j = sqs.length - 1; j >= 0; j--) if (key(items[sqs[j]].sq) < k) return sqs[j];
        return sqs.length ? sqs[sqs.length - 1] : items.length - 1;
    }
    /** Push: the cursor moves one square on the screen; right of the board are the buttons (push W goes back). */
    pushCursor(dir) {
        if (this.cursor.kind === 'btn') {
            const bs = this.buttons(), i = bs.indexOf(this.cursor.id);
            if (dir === 'E' && i + 1 < bs.length) this.cursor = { kind: 'btn', id: bs[i + 1] };
            else if (dir === 'W' && i > 0) this.cursor = { kind: 'btn', id: bs[i - 1] };
            else if (dir === 'W') this.cursor = { kind: 'sq', sq: this.sel >= 0 ? this.sel : look.square(this, 7, 7) };
            return;
        }
        if (this.cursor.kind !== 'sq') return;
        const v = look.view(this, this.cursor.sq);
        let col = v.col + (dir === 'E' ? 1 : dir === 'W' ? -1 : 0), row = v.row + (dir === 'S' ? 1 : dir === 'N' ? -1 : 0);
        if (col > 7) { const bs = this.buttons(); if (bs.length) this.cursor = { kind: 'btn', id: bs[0] }; return; }
        col = Math.max(0, Math.min(7, col)); row = Math.max(0, Math.min(7, row));
        this.cursor = { kind: 'sq', sq: look.square(this, col, row) };
    }
    /** Pick up, put down or drop a piece on square sq (knob press, or a tap). */
    choose(sq, device) {
        const b = this.b, p = b.sq[sq];
        const mine = p && E.colorOf(p) === b.side && this.movesFrom(sq).length > 0;
        if (this.sel >= 0) {
            if (sq === this.sel) { this.sel = -1; return; }
            if (this.tryMove(sq, device)) return;
            if (mine) { this.sel = sq; return; }
            this.sel = -1;
            return;
        }
        if (mine) this.sel = sq;
        else if (p && E.colorOf(p) === b.side) this.note('That piece can\'t move');
    }

    /* ---------- touch ---------- */
    touch(ev) {
        const sq = look.hitSquare(this, ev.x, ev.y);
        if (this.promo) {
            if (ev.phase !== 'up') return;
            if (this.promo.device !== 'touch' && !this.canMove('touch')) return;
            const i = look.promoHit(this, ev.x, ev.y);
            if (i >= 0) this.doMove(this.promo.moves[i]);
            else this.promo = null;
            return;
        }
        if (ev.phase === 'down') {
            this.down = { x: ev.x, y: ev.y, sq, btn: look.buttonHit(this, ev.x, ev.y) };
            if (sq < 0 || !this.canMove('touch')) return;
            const p = this.b.sq[sq];
            const mine = p && E.colorOf(p) === this.b.side && this.movesFrom(sq).length > 0;
            if (mine) {
                const wasSel = this.sel === sq;
                this.sel = sq;
                this.drag = { from: sq, x: ev.x, y: ev.y, moved: false, wasSel };
            }
            return;
        }
        if (ev.phase === 'move') {
            if (this.drag) { this.drag.x = ev.x; this.drag.y = ev.y; if (this.down && Math.abs(ev.x - this.down.x) + Math.abs(ev.y - this.down.y) > 16) this.drag.moved = true; }
            return;
        }
        if (ev.phase !== 'up') return;
        const down = this.down, drag = this.drag;
        this.down = null; this.drag = null;
        if (!down) return;
        const btn = look.buttonHit(this, ev.x, ev.y);
        if (btn && btn === down.btn) {
            if (btn === 'new' || btn === 'undo' || this.mode === 'computer' || !this.result) this.button(btn, 'touch');
            return;
        }
        if (!this.canMove('touch')) {
            if (sq >= 0 && this.mode === 'friend' && !this.result && !this.anim) this.note((this.b.side ? 'Black' : 'White') + ' plays with the knob');
            return;
        }
        if (drag) {
            if (sq >= 0 && sq !== drag.from) { if (!this.tryMove(sq, 'touch')) this.sel = drag.moved ? -1 : this.sel; return; }
            if (sq === drag.from && drag.wasSel && !drag.moved) this.sel = -1;      // a second tap puts it back
            return;
        }
        if (sq < 0) { this.sel = -1; return; }
        if (sq === down.sq) this.choose(sq, 'touch');
    }

    pause() { this.paused = true; this.drag = null; this.down = null; }
    resume() { this.paused = false; }
}

module.exports = {
    id: 'chess',
    title: 'Chess',
    blurb: 'Vs computer or 2 players',
    order: 80,
    needs: [],
    score: { unit: 'pts', lower: false },
    art: look.art,
    create(api) { return new Game(api); },
    Game,
};
