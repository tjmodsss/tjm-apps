'use strict';
/**
 * engine.js - the rules of chess and a small engine to play against. No drawing here.
 *
 *   const { Board, Search } = require('./engine');
 *   const b = new Board();                 // the start position (or new Board(fen))
 *   b.legal()                              -> [move, ...]   (moves are ints, see below)
 *   b.play(move) / b.undo()
 *   b.san(move), b.uci(move), b.fromUci('e2e4'), b.fen(), b.status()
 *   const s = new Search(b, LEVELS.medium, random);
 *   while (!s.step(3000)) {}               // think in slices of about 3000 nodes; then s.best
 *
 * The board is 0x88: square = rank * 16 + file, a1 = 0, h8 = 119. A piece is its type (1 pawn,
 * 2 knight, 3 bishop, 4 rook, 5 queen, 6 king) + 8 for black. A move is
 * from | to << 7 | promotion type << 14 | flags << 17.
 *
 * Written for Parked Games (MIT, like the rest of this repository): the evaluation and the
 * search are our own, plain alpha-beta with quiescence, a transposition table, killer moves and
 * iterative deepening. The search can stop after any number of nodes and go on later, so the
 * frame never waits for it (Node 8 on the car has no worker threads).
 */

const PAWN = 1, KNIGHT = 2, BISHOP = 3, ROOK = 4, QUEEN = 5, KING = 6, BLACK = 8;
const WHITE_SIDE = 0, BLACK_SIDE = 1;
const F_CAPTURE = 1, F_EP = 2, F_CASTLE = 4, F_DOUBLE = 8;
const VALUE = [0, 100, 310, 325, 500, 900, 0];
const PHASE = [0, 0, 1, 1, 2, 4, 0];
const KNIGHT_D = [33, 31, 18, 14, -33, -31, -18, -14];
const KING_D = [1, -1, 16, -16, 15, 17, -15, -17];
const BISHOP_D = [15, 17, -15, -17];
const ROOK_D = [1, -1, 16, -16];
const MATE = 30000, INF = 32000;

const mv = (from, to, promo, flags) => from | (to << 7) | ((promo || 0) << 14) | ((flags || 0) << 17);
const mFrom = (m) => m & 127;
const mTo = (m) => (m >> 7) & 127;
const mPromo = (m) => (m >> 14) & 7;
const mFlags = (m) => (m >> 17) & 15;
const sqName = (s) => 'abcdefgh'[s & 7] + ((s >> 4) + 1);
const sqOf = (name) => (name.charCodeAt(1) - 49) * 16 + (name.charCodeAt(0) - 97);
const colorOf = (p) => (p & BLACK ? BLACK_SIDE : WHITE_SIDE);
const typeOf = (p) => p & 7;
const LETTER = ' pnbrqk';

/* ---------- Zobrist keys (two 32-bit halves, from a fixed seed) ---------- */
let zseed = 0x2545f491;
const zr = () => { zseed ^= zseed << 13; zseed ^= zseed >>> 17; zseed ^= zseed << 5; return zseed | 0; };
const ZP_LO = new Int32Array(16 * 128), ZP_HI = new Int32Array(16 * 128);
for (let i = 0; i < ZP_LO.length; i++) { ZP_LO[i] = zr(); ZP_HI[i] = zr(); }
const ZC_LO = new Int32Array(16), ZC_HI = new Int32Array(16);
for (let i = 0; i < 16; i++) { ZC_LO[i] = zr(); ZC_HI[i] = zr(); }
const ZE_LO = new Int32Array(8), ZE_HI = new Int32Array(8);
for (let i = 0; i < 8; i++) { ZE_LO[i] = zr(); ZE_HI[i] = zr(); }
const ZS_LO = zr(), ZS_HI = zr();

// castling rights lost when a piece leaves or lands on a square: 1 white short, 2 white long, 4 black short, 8 black long
const CASTLE_MASK = new Int8Array(128).fill(15);
CASTLE_MASK[sqOf('e1')] = 15 & ~3; CASTLE_MASK[sqOf('h1')] = 15 & ~1; CASTLE_MASK[sqOf('a1')] = 15 & ~2;
CASTLE_MASK[sqOf('e8')] = 15 & ~12; CASTLE_MASK[sqOf('h8')] = 15 & ~4; CASTLE_MASK[sqOf('a8')] = 15 & ~8;

/* ---------- piece-square values (white's view; black reads them mirrored). Our own formulas. ---------- */
const PST_MG = [], PST_EG = [];
(function buildPst() {
    for (let t = 0; t <= 6; t++) { PST_MG.push(new Int16Array(128)); PST_EG.push(new Int16Array(128)); }
    const PAWN_EG = [0, 4, 8, 16, 30, 52, 84, 0];
    for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
        const s = r * 16 + f;
        const fc = 3.5 - Math.abs(f - 3.5), rc = 3.5 - Math.abs(r - 3.5);          // 0.5 (edge) .. 3.5 (centre)
        const c = fc + rc;                                                          // 1 .. 7
        // pawns: move up, hold the centre, don't leave the king's shelter too early
        let pm = r * 4;
        if ((f === 3 || f === 4) && (r === 3 || r === 4)) pm += 18;
        else if ((f === 2 || f === 5) && (r >= 2 && r <= 4)) pm += 6;
        if ((f <= 2 || f >= 5) && r === 1) pm += 6;
        if (r === 6) pm += 20;
        PST_MG[PAWN][s] = r === 0 || r === 7 ? 0 : pm;
        PST_EG[PAWN][s] = PAWN_EG[r];
        // knights love the centre and hate the rim
        PST_MG[KNIGHT][s] = Math.round((c - 4.5) * 9) - (r === 0 ? 6 : 0);
        PST_EG[KNIGHT][s] = Math.round((c - 4.5) * 6);
        // bishops: long diagonals, out of the back rank
        PST_MG[BISHOP][s] = Math.round((c - 4.5) * 4) + (f === r || f === 7 - r ? 6 : 0) - (r === 0 ? 8 : 0);
        PST_EG[BISHOP][s] = Math.round((c - 4.5) * 4);
        // rooks: the seventh rank and the middle files
        PST_MG[ROOK][s] = (r === 6 ? 16 : 0) + (f === 3 || f === 4 ? 5 : 0) - (f === 0 || f === 7 ? 2 : 0);
        PST_EG[ROOK][s] = r === 6 ? 10 : 0;
        // queen: a little centre, not out too early (handled by the back-rank bonus)
        PST_MG[QUEEN][s] = Math.round((c - 4.5) * 2) + (r === 0 ? 2 : 0);
        PST_EG[QUEEN][s] = Math.round((c - 4.5) * 5);
        // king: behind the pawns in the middle game, in the centre in the end game
        PST_MG[KING][s] = r === 0 ? ((f <= 2 || f >= 6) ? 24 : f === 3 || f === 4 ? 0 : 8) : -14 * r - 6;
        PST_EG[KING][s] = Math.round((c - 4.5) * 10);
    }
})();

class Board {
    constructor(fen) {
        this.sq = new Int8Array(128);
        this.king = [0, 0];
        this.side = WHITE_SIDE;
        this.castle = 0;
        this.ep = -1;
        this.half = 0;
        this.full = 1;
        this.lo = 0; this.hi = 0;
        this.hist = [];           // undo records
        this.keys = [];           // position keys before each move (repetitions)
        this.setFen(fen || 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    }

    /* ---------- FEN ---------- */
    setFen(fen) {
        const parts = String(fen).trim().split(/\s+/);
        this.sq.fill(0);
        const rows = parts[0].split('/');
        if (rows.length !== 8) throw new Error('bad FEN: ' + fen);
        for (let i = 0; i < 8; i++) {
            let f = 0;
            const r = 7 - i;
            for (const ch of rows[i]) {
                if (ch >= '1' && ch <= '8') { f += +ch; continue; }
                const t = LETTER.indexOf(ch.toLowerCase());
                if (t <= 0 || f > 7) throw new Error('bad FEN: ' + fen);
                const p = t | (ch === ch.toLowerCase() ? BLACK : 0);
                this.sq[r * 16 + f] = p;
                if (t === KING) this.king[colorOf(p)] = r * 16 + f;
                f++;
            }
        }
        this.side = parts[1] === 'b' ? BLACK_SIDE : WHITE_SIDE;
        const c = parts[2] || '-';
        this.castle = (c.indexOf('K') >= 0 ? 1 : 0) | (c.indexOf('Q') >= 0 ? 2 : 0) | (c.indexOf('k') >= 0 ? 4 : 0) | (c.indexOf('q') >= 0 ? 8 : 0);
        this.ep = parts[3] && parts[3] !== '-' ? sqOf(parts[3]) : -1;
        this.half = parseInt(parts[4] || '0', 10) || 0;
        this.full = parseInt(parts[5] || '1', 10) || 1;
        this.hist = []; this.keys = [];
        this.rehash();
    }
    fen() {
        const rows = [];
        for (let r = 7; r >= 0; r--) {
            let s = '', n = 0;
            for (let f = 0; f < 8; f++) {
                const p = this.sq[r * 16 + f];
                if (!p) { n++; continue; }
                if (n) { s += n; n = 0; }
                const l = LETTER[typeOf(p)];
                s += p & BLACK ? l : l.toUpperCase();
            }
            rows.push(s + (n ? n : ''));
        }
        const c = (this.castle & 1 ? 'K' : '') + (this.castle & 2 ? 'Q' : '') + (this.castle & 4 ? 'k' : '') + (this.castle & 8 ? 'q' : '');
        return rows.join('/') + ' ' + (this.side ? 'b' : 'w') + ' ' + (c || '-') + ' ' + (this.ep >= 0 ? sqName(this.ep) : '-') + ' ' + this.half + ' ' + this.full;
    }
    rehash() {
        let lo = 0, hi = 0;
        for (let s = 0; s < 128; s++) { if (s & 0x88) { s += 7; continue; } const p = this.sq[s]; if (p) { lo ^= ZP_LO[p * 128 + s]; hi ^= ZP_HI[p * 128 + s]; } }
        lo ^= ZC_LO[this.castle]; hi ^= ZC_HI[this.castle];
        if (this.ep >= 0) { lo ^= ZE_LO[this.ep & 7]; hi ^= ZE_HI[this.ep & 7]; }
        if (this.side) { lo ^= ZS_LO; hi ^= ZS_HI; }
        this.lo = lo; this.hi = hi;
    }

    /* ---------- attacks ---------- */
    /** Is square s attacked by side `by`? */
    attacked(s, by) {
        const b = this.sq, own = by ? BLACK : 0;
        // pawns
        if (by === WHITE_SIDE) {
            const a = s - 15, c = s - 17;
            if (!(a & 0x88) && b[a] === PAWN) return true;
            if (!(c & 0x88) && b[c] === PAWN) return true;
        } else {
            const a = s + 15, c = s + 17;
            if (!(a & 0x88) && b[a] === (PAWN | BLACK)) return true;
            if (!(c & 0x88) && b[c] === (PAWN | BLACK)) return true;
        }
        for (let i = 0; i < 8; i++) { const t = s + KNIGHT_D[i]; if (!(t & 0x88) && b[t] === (KNIGHT | own)) return true; }
        for (let i = 0; i < 8; i++) { const t = s + KING_D[i]; if (!(t & 0x88) && b[t] === (KING | own)) return true; }
        for (let i = 0; i < 4; i++) {
            const d = BISHOP_D[i];
            for (let t = s + d; !(t & 0x88); t += d) {
                const p = b[t];
                if (!p) continue;
                if (p === (BISHOP | own) || p === (QUEEN | own)) return true;
                break;
            }
        }
        for (let i = 0; i < 4; i++) {
            const d = ROOK_D[i];
            for (let t = s + d; !(t & 0x88); t += d) {
                const p = b[t];
                if (!p) continue;
                if (p === (ROOK | own) || p === (QUEEN | own)) return true;
                break;
            }
        }
        return false;
    }
    inCheck(side) { if (side === undefined) side = this.side; return this.attacked(this.king[side], side ^ 1); }

    /* ---------- moves ---------- */
    /** Pseudo-legal moves into `out` (captures and promotions only when `noisy`). */
    gen(out, noisy) {
        const b = this.sq, us = this.side, own = us ? BLACK : 0;
        const fwd = us ? -16 : 16, start = us ? 6 : 1, last = us ? 0 : 7;
        for (let s = 0; s < 128; s++) {
            if (s & 0x88) { s += 7; continue; }
            const p = b[s];
            if (!p || (p & BLACK) !== own) continue;
            const t = p & 7;
            if (t === PAWN) {
                const one = s + fwd;
                if (!(one & 0x88) && !b[one]) {
                    if ((one >> 4) === last) { for (let q = QUEEN; q >= KNIGHT; q--) out.push(mv(s, one, q, 0)); }
                    else if (!noisy) {
                        out.push(mv(s, one, 0, 0));
                        const two = one + fwd;
                        if ((s >> 4) === start && !b[two]) out.push(mv(s, two, 0, F_DOUBLE));
                    }
                }
                for (let k = -1; k <= 1; k += 2) {
                    const c = one + k;
                    if (c & 0x88) continue;
                    const q = b[c];
                    if (q && (q & BLACK) !== own) {
                        if ((c >> 4) === last) { for (let pr = QUEEN; pr >= KNIGHT; pr--) out.push(mv(s, c, pr, F_CAPTURE)); }
                        else out.push(mv(s, c, 0, F_CAPTURE));
                    } else if (c === this.ep) out.push(mv(s, c, 0, F_CAPTURE | F_EP));
                }
            } else if (t === KNIGHT || t === KING) {
                const D = t === KNIGHT ? KNIGHT_D : KING_D;
                for (let i = 0; i < 8; i++) {
                    const to = s + D[i];
                    if (to & 0x88) continue;
                    const q = b[to];
                    if (!q) { if (!noisy) out.push(mv(s, to, 0, 0)); } else if ((q & BLACK) !== own) out.push(mv(s, to, 0, F_CAPTURE));
                }
                if (t === KING && !noisy) this.genCastles(out, s);
            } else {
                const D = t === BISHOP ? BISHOP_D : t === ROOK ? ROOK_D : KING_D;
                for (let i = 0; i < D.length; i++) {
                    const d = D[i];
                    for (let to = s + d; !(to & 0x88); to += d) {
                        const q = b[to];
                        if (!q) { if (!noisy) out.push(mv(s, to, 0, 0)); continue; }
                        if ((q & BLACK) !== own) out.push(mv(s, to, 0, F_CAPTURE));
                        break;
                    }
                }
            }
        }
        return out;
    }
    genCastles(out, s) {
        const b = this.sq, us = this.side, them = us ^ 1;
        const home = us ? 0x74 : 0x04;                      // e8 / e1
        if (s !== home) return;
        const shortR = us ? 4 : 1, longR = us ? 8 : 2;
        if ((this.castle & (shortR | longR)) === 0 || this.attacked(s, them)) return;
        if ((this.castle & shortR) && !b[s + 1] && !b[s + 2] && !this.attacked(s + 1, them) && !this.attacked(s + 2, them)) out.push(mv(s, s + 2, 0, F_CASTLE));
        if ((this.castle & longR) && !b[s - 1] && !b[s - 2] && !b[s - 3] && !this.attacked(s - 1, them) && !this.attacked(s - 2, them)) out.push(mv(s, s - 2, 0, F_CASTLE));
    }
    /** Every legal move of the side to move. */
    legal() {
        const out = [], ps = this.gen([], false);
        for (let i = 0; i < ps.length; i++) {
            if (this.make(ps[i])) out.push(ps[i]);
            this.unmake();
        }
        return out;
    }

    _put(s, p) { this.sq[s] = p; this.lo ^= ZP_LO[p * 128 + s]; this.hi ^= ZP_HI[p * 128 + s]; }
    _take(s) { const p = this.sq[s]; this.sq[s] = 0; this.lo ^= ZP_LO[p * 128 + s]; this.hi ^= ZP_HI[p * 128 + s]; return p; }

    /** Makes a pseudo-legal move; returns false when it leaves the mover's king in check (call unmake() anyway). */
    make(m) {
        const from = mFrom(m), to = mTo(m), fl = mFlags(m), promo = mPromo(m), us = this.side;
        const b = this.sq;
        this.keys.push(this.lo, this.hi);
        const rec = { m, cap: 0, castle: this.castle, ep: this.ep, half: this.half, lo: this.lo, hi: this.hi };
        this.hist.push(rec);
        const p = this._take(from);
        if (fl & F_EP) rec.cap = this._take(to + (us ? 16 : -16));
        else if (b[to]) rec.cap = this._take(to);
        this._put(to, promo ? (promo | (us ? BLACK : 0)) : p);
        if (fl & F_CASTLE) {
            const shortSide = to > from;
            const rf = shortSide ? from + 3 : from - 4, rt = shortSide ? from + 1 : from - 1;
            this._put(rt, this._take(rf));
        }
        if ((p & 7) === KING) this.king[us] = to;
        // castling rights, en passant, clocks, side
        this.lo ^= ZC_LO[this.castle]; this.hi ^= ZC_HI[this.castle];
        this.castle &= CASTLE_MASK[from] & CASTLE_MASK[to];
        this.lo ^= ZC_LO[this.castle]; this.hi ^= ZC_HI[this.castle];
        if (this.ep >= 0) { this.lo ^= ZE_LO[this.ep & 7]; this.hi ^= ZE_HI[this.ep & 7]; }
        this.ep = fl & F_DOUBLE ? (from + to) >> 1 : -1;
        if (this.ep >= 0) { this.lo ^= ZE_LO[this.ep & 7]; this.hi ^= ZE_HI[this.ep & 7]; }
        this.half = (p & 7) === PAWN || rec.cap ? 0 : this.half + 1;
        if (us === BLACK_SIDE) this.full++;
        this.side = us ^ 1;
        this.lo ^= ZS_LO; this.hi ^= ZS_HI;
        return !this.attacked(this.king[us], us ^ 1);
    }
    unmake() {
        const rec = this.hist.pop();
        this.keys.length -= 2;
        const m = rec.m, from = mFrom(m), to = mTo(m), fl = mFlags(m);
        this.side ^= 1;
        const us = this.side, b = this.sq;
        let p = b[to];
        if (mPromo(m)) p = PAWN | (us ? BLACK : 0);
        b[to] = 0;
        b[from] = p;
        if (rec.cap) { if (fl & F_EP) b[to + (us ? 16 : -16)] = rec.cap; else b[to] = rec.cap; }
        if (fl & F_CASTLE) {
            const shortSide = to > from;
            const rf = shortSide ? from + 3 : from - 4, rt = shortSide ? from + 1 : from - 1;
            b[rf] = b[rt]; b[rt] = 0;
        }
        if ((p & 7) === KING) this.king[us] = from;
        if (us === BLACK_SIDE) this.full--;
        this.castle = rec.castle; this.ep = rec.ep; this.half = rec.half; this.lo = rec.lo; this.hi = rec.hi;
        return rec;
    }
    /** Plays a legal move (from legal()); returns false if it isn't one. */
    play(m) {
        if (this.legal().indexOf(m) < 0) return false;
        this.make(m);
        return true;
    }
    undo() { if (!this.hist.length) return null; return this.unmake(); }
    get ply() { return this.hist.length; }
    lastMove() { return this.hist.length ? this.hist[this.hist.length - 1].m : 0; }
    lastCapture() { return this.hist.length ? this.hist[this.hist.length - 1].cap : 0; }

    /** How many times the current position stood on the board before (same side to move). */
    repeats() {
        let n = 0;
        const k = this.keys, stop = Math.max(0, k.length - this.half * 2 - 2);
        for (let i = k.length - 4; i >= stop; i -= 4) if (k[i] === this.lo && k[i + 1] === this.hi) n++;
        return n;
    }
    insufficient() {
        let minors = 0, bishopsOn = [0, 0];
        for (let s = 0; s < 128; s++) {
            if (s & 0x88) { s += 7; continue; }
            const t = this.sq[s] & 7;
            if (!t || t === KING) continue;
            if (t === PAWN || t === ROOK || t === QUEEN) return false;
            minors++;
            if (t === BISHOP) bishopsOn[((s >> 4) + (s & 7)) & 1]++;
        }
        if (minors <= 1) return true;
        // only bishops, all on one colour
        let knights = 0;
        for (let s = 0; s < 128; s++) { if (s & 0x88) { s += 7; continue; } if ((this.sq[s] & 7) === KNIGHT) knights++; }
        return knights === 0 && (bishopsOn[0] === 0 || bishopsOn[1] === 0);
    }
    /** { over, result: '1-0' | '0-1' | '1/2-1/2' | null, why: 'checkmate' | 'stalemate' | 'fifty' | 'repetition' | 'material', check } */
    status() {
        const check = this.inCheck(), moves = this.legal();
        if (!moves.length) {
            if (check) return { over: true, result: this.side ? '1-0' : '0-1', why: 'checkmate', check, winner: this.side ^ 1 };
            return { over: true, result: '1/2-1/2', why: 'stalemate', check, winner: -1 };
        }
        if (this.half >= 100) return { over: true, result: '1/2-1/2', why: 'fifty', check, winner: -1 };
        if (this.repeats() >= 2) return { over: true, result: '1/2-1/2', why: 'repetition', check, winner: -1 };
        if (this.insufficient()) return { over: true, result: '1/2-1/2', why: 'material', check, winner: -1 };
        return { over: false, result: null, why: null, check, winner: -1, moves };
    }

    /* ---------- notation ---------- */
    uci(m) { return sqName(mFrom(m)) + sqName(mTo(m)) + (mPromo(m) ? LETTER[mPromo(m)] : ''); }
    fromUci(s) {
        const ms = this.legal();
        for (let i = 0; i < ms.length; i++) if (this.uci(ms[i]) === s) return ms[i];
        return 0;
    }
    /** Standard algebraic notation of a legal move in this position (e.g. Nbd7, exd5, O-O, e8=Q+) */
    san(m) {
        const from = mFrom(m), to = mTo(m), p = this.sq[from], t = p & 7;
        let s;
        if (mFlags(m) & F_CASTLE) s = to > from ? 'O-O' : 'O-O-O';
        else {
            const cap = (mFlags(m) & F_CAPTURE) !== 0;
            if (t === PAWN) s = (cap ? 'abcdefgh'[from & 7] + 'x' : '') + sqName(to) + (mPromo(m) ? '=' + LETTER[mPromo(m)].toUpperCase() : '');
            else {
                s = LETTER[t].toUpperCase();
                const others = this.legal().filter((o) => o !== m && mTo(o) === to && this.sq[mFrom(o)] === p);
                if (others.length) {
                    const sameFile = others.some((o) => (mFrom(o) & 7) === (from & 7));
                    const sameRank = others.some((o) => (mFrom(o) >> 4) === (from >> 4));
                    if (!sameFile) s += 'abcdefgh'[from & 7];
                    else if (!sameRank) s += (from >> 4) + 1;
                    else s += sqName(from);
                }
                s += (cap ? 'x' : '') + sqName(to);
            }
        }
        this.make(m);
        if (this.inCheck()) s += this.legal().length ? '+' : '#';
        this.unmake();
        return s;
    }

    /* ---------- evaluation (centipawns, from the side to move's view) ---------- */
    evaluate() {
        const b = this.sq;
        let mg = 0, eg = 0, phase = 0;
        let bishops0 = 0, bishops1 = 0;
        const pf0 = [0, 0, 0, 0, 0, 0, 0, 0], pf1 = [0, 0, 0, 0, 0, 0, 0, 0];       // pawns per file
        const lead0 = [-1, -1, -1, -1, -1, -1, -1, -1], lead1 = [8, 8, 8, 8, 8, 8, 8, 8];  // white's most advanced / black's
        const back0 = [8, 8, 8, 8, 8, 8, 8, 8], back1 = [-1, -1, -1, -1, -1, -1, -1, -1];
        for (let s = 0; s < 128; s++) {
            if (s & 0x88) { s += 7; continue; }
            const p = b[s];
            if (!p) continue;
            const t = p & 7;
            phase += PHASE[t];
            if (p & BLACK) {
                const ms = s ^ 0x70;           // mirror the rank
                mg -= VALUE[t] + PST_MG[t][ms]; eg -= VALUE[t] + PST_EG[t][ms];
                if (t === BISHOP) bishops1++;
                else if (t === PAWN) { const f = s & 7, r = s >> 4; pf1[f]++; if (r < lead1[f]) lead1[f] = r; if (r > back1[f]) back1[f] = r; }
            } else {
                mg += VALUE[t] + PST_MG[t][s]; eg += VALUE[t] + PST_EG[t][s];
                if (t === BISHOP) bishops0++;
                else if (t === PAWN) { const f = s & 7, r = s >> 4; pf0[f]++; if (r > lead0[f]) lead0[f] = r; if (r < back0[f]) back0[f] = r; }
            }
        }
        let st = 0;
        if (bishops0 >= 2) st += 30;
        if (bishops1 >= 2) st -= 30;
        // pawn structure: doubled, isolated, passed
        let pass = 0;
        for (let f = 0; f < 8; f++) {
            if (pf0[f] > 1) st -= 12 * (pf0[f] - 1);
            if (pf1[f] > 1) st += 12 * (pf1[f] - 1);
            const l = f > 0 ? f - 1 : f, r = f < 7 ? f + 1 : f;
            if (pf0[f] && !(f > 0 && pf0[f - 1]) && !(f < 7 && pf0[f + 1])) st -= 10;
            if (pf1[f] && !(f > 0 && pf1[f - 1]) && !(f < 7 && pf1[f + 1])) st += 10;
            if (lead0[f] >= 0) {
                const rk = lead0[f];
                let free = true;
                for (let g = l; g <= r; g++) if (pf1[g] && back1[g] > rk) free = false;
                if (free) pass += 6 + rk * rk * 3;
            }
            if (lead1[f] < 8) {
                const rk = 7 - lead1[f];
                let free = true;
                for (let g = l; g <= r; g++) if (pf0[g] && back0[g] < lead1[f]) free = false;
                if (free) pass -= 6 + rk * rk * 3;
            }
            // rooks on open files are counted below
        }
        for (let s = 0; s < 128; s++) {
            if (s & 0x88) { s += 7; continue; }
            const p = b[s];
            if ((p & 7) !== ROOK) continue;
            const f = s & 7;
            if (p & BLACK) { if (!pf1[f]) st -= pf0[f] ? 6 : 14; } else if (!pf0[f]) st += pf1[f] ? 6 : 14;
        }
        if (phase > 24) phase = 24;
        const score = Math.round((mg * phase + (eg + pass) * (24 - phase)) / 24 + pass * 0.4) + st;
        return this.side ? -score : score;
    }
}

/* ---------- levels ---------- */
// depth: the deepest full-width search; nodes: the most it thinks per move; margin: it picks at random among
// the moves within `margin` centipawns of its best (that is how the easy levels make mistakes)
const LEVELS = {
    easy: { id: 'easy', name: 'Easy', depth: 2, nodes: 12000, margin: 140, points: 100 },
    medium: { id: 'medium', name: 'Medium', depth: 3, nodes: 60000, margin: 30, points: 200 },
    hard: { id: 'hard', name: 'Hard', depth: 6, nodes: 260000, margin: 0, points: 300 },
};

/* ---------- the search ---------- */
const TT_BITS = 17, TT_SIZE = 1 << TT_BITS, TT_MASK = TT_SIZE - 1;
const EXACT = 1, LOWER = 2, UPPER = 3;

class Search {
    /**
     * @param board  the position (searched in place, left as it was after every step)
     * @param level  LEVELS.x
     * @param random 0..1 (picks among near-equal moves)
     */
    constructor(board, level, random, tt) {
        this.b = board;
        this.level = level;
        this.random = random || Math.random;
        this.tt = tt || Search.table();
        this.nodes = 0;
        this.done = false;
        this.best = 0;
        this.depth = 0;               // the last depth searched completely
        this.killers = new Int32Array(128 * 2);
        this.hist = new Int32Array(16 * 128);
        const legal = board.legal();
        this.root = legal.map((m) => ({ m, score: -INF, prev: -INF }));
        this.cur = 1; this.idx = 0; this.alpha = -INF;
        this.full = level.margin > 0 || board.full <= 3;       // exact scores for every root move (to pick among them)
        if (this.root.length <= 1) { this.done = true; this.best = legal[0] || 0; }
    }
    static table() {
        return { lo: new Int32Array(TT_SIZE), hi: new Int32Array(TT_SIZE), move: new Int32Array(TT_SIZE),
            score: new Int16Array(TT_SIZE), depth: new Int8Array(TT_SIZE), flag: new Int8Array(TT_SIZE) };
    }
    /** Thinks for about `budget` more nodes. Returns true when it has chosen (this.best). */
    step(budget) {
        if (this.done) return true;
        // a move cut off half-way is searched again next time (the table keeps most of the work); each
        // retry of the same move gets twice the nodes, so a big subtree always finishes in the end
        this.stopAt = this.nodes + budget * (1 << Math.min(this.retry || 0, 8));
        if (this.depth > 0) {
            // past its thinking budget it plays the best of the last complete depth
            if (this.nodes >= this.level.nodes) { this.finish(); return true; }
            this.stopAt = Math.min(this.stopAt, this.level.nodes);
        }
        this.stop = false;
        while (!this.done) {
            const r = this.root[this.idx];
            const b = this.b;
            b.make(r.m);
            const alpha = this.full ? -INF : this.alpha;
            const sc = -this.negamax(this.cur - 1, -INF, -alpha, 1);
            b.unmake();
            if (this.stop) { this.retry = (this.retry || 0) + 1; return false; }     // go on with this move next time
            this.retry = 0;
            r.score = sc;
            if (sc > this.alpha) this.alpha = sc;
            this.idx++;
            if (this.idx >= this.root.length) this.finishDepth();
            else if (this.nodes >= this.level.nodes && this.depth > 0) this.finish();
            if (!this.done && this.nodes >= this.stopAt) return false;
        }
        return true;
    }
    finishDepth() {
        this.depth = this.cur;
        this.root.forEach((r) => { r.prev = r.score; });
        this.root.sort((x, y) => y.prev - x.prev);
        const top = this.root[0].prev;
        if (this.cur >= this.level.depth || this.nodes >= this.level.nodes || Math.abs(top) > MATE - 200) { this.finish(); return; }
        this.cur++; this.idx = 0; this.alpha = -INF;
        this.root.forEach((r) => { r.score = -INF; });
    }
    finish() {
        // the moves of the last complete depth, best first (a partly searched depth only counts when its first move,
        // the previous best, was searched again and is still best)
        let list = this.root.slice().sort((x, y) => y.prev - x.prev);
        const top = list[0].prev;
        const margin = this.level.margin || (this.b.full <= 3 ? 12 : 0);
        let pick = list[0];
        if (margin > 0 && Math.abs(top) < MATE - 200) {
            const near = list.filter((r) => r.prev >= top - margin);
            pick = near[Math.min(near.length - 1, Math.floor(this.random() * near.length))];
        }
        this.best = pick.m;
        this.score = pick.prev;
        this.done = true;
    }

    negamax(depth, alpha, beta, ply) {
        const b = this.b;
        if ((++this.nodes & 255) === 0 && this.nodes >= this.stopAt) this.stop = true;
        if (this.stop) return 0;
        if (b.half >= 100 || b.repeats() > 0) return 0;
        if (ply > 60) return b.evaluate();
        const check = b.inCheck();
        if (check) depth++;
        if (depth <= 0) return this.quiesce(alpha, beta, ply);
        // mate distance
        if (alpha < -MATE + ply) alpha = -MATE + ply;
        if (beta > MATE - ply) beta = MATE - ply;
        if (alpha >= beta) return alpha;

        const tt = this.tt, i = b.lo & TT_MASK;
        let ttMove = 0;
        if (tt.lo[i] === b.lo && tt.hi[i] === b.hi) {
            ttMove = tt.move[i];
            if (tt.depth[i] >= depth) {
                let s = tt.score[i];
                if (s > MATE - 200) s -= ply; else if (s < -MATE + 200) s += ply;
                const f = tt.flag[i];
                if (f === EXACT || (f === LOWER && s >= beta) || (f === UPPER && s <= alpha)) return s;
            }
        }

        const moves = b.gen([], false);
        const order = this.order(moves, ttMove, ply);
        const a0 = alpha;
        let best = -INF, bestMove = 0, legal = 0;
        for (let k = 0; k < order.length; k++) {
            const m = order[k];
            if (!b.make(m)) { b.unmake(); continue; }
            legal++;
            const sc = -this.negamax(depth - 1, -beta, -alpha, ply + 1);
            b.unmake();
            if (this.stop) return 0;
            if (sc > best) { best = sc; bestMove = m; }
            if (sc > alpha) {
                alpha = sc;
                if (alpha >= beta) {
                    if (!(mFlags(m) & F_CAPTURE)) {
                        const kk = ply * 2;
                        if (this.killers[kk] !== m) { this.killers[kk + 1] = this.killers[kk]; this.killers[kk] = m; }
                        this.hist[b.sq[mFrom(m)] * 128 + mTo(m)] += depth * depth;
                    }
                    break;
                }
            }
        }
        if (!legal) return check ? -MATE + ply : 0;
        let st = best;
        if (st > MATE - 200) st += ply; else if (st < -MATE + 200) st -= ply;
        tt.lo[i] = b.lo; tt.hi[i] = b.hi; tt.move[i] = bestMove; tt.score[i] = st; tt.depth[i] = depth;
        tt.flag[i] = best >= beta ? LOWER : best <= a0 ? UPPER : EXACT;
        return best;
    }
    quiesce(alpha, beta, ply) {
        const b = this.b;
        if ((++this.nodes & 255) === 0 && this.nodes >= this.stopAt) this.stop = true;
        if (this.stop) return 0;
        const stand = b.evaluate();
        if (stand >= beta || ply > 60) return stand;
        if (stand > alpha) alpha = stand;
        const moves = b.gen([], true);
        const order = this.order(moves, 0, ply);
        for (let k = 0; k < order.length; k++) {
            const m = order[k];
            // a capture that can't lift us near alpha isn't worth a look
            if (!mPromo(m) && stand + VALUE[b.sq[mTo(m)] & 7] + 200 < alpha && !(mFlags(m) & F_EP)) continue;
            if (!b.make(m)) { b.unmake(); continue; }
            const sc = -this.quiesce(-beta, -alpha, ply + 1);
            b.unmake();
            if (this.stop) return 0;
            if (sc > alpha) { alpha = sc; if (alpha >= beta) break; }
        }
        return alpha;
    }
    /** Moves in search order: the table's move, captures (most valuable victim first), promotions, killers, history. */
    order(moves, ttMove, ply) {
        const b = this.b, n = moves.length, keys = new Array(n);
        const k0 = this.killers[ply * 2], k1 = this.killers[ply * 2 + 1];
        for (let i = 0; i < n; i++) {
            const m = moves[i];
            let s;
            if (m === ttMove) s = 1e9;
            else if (mFlags(m) & F_CAPTURE) s = 1e8 + VALUE[(mFlags(m) & F_EP) ? PAWN : b.sq[mTo(m)] & 7] * 16 - VALUE[b.sq[mFrom(m)] & 7] / 8;
            else if (mPromo(m)) s = 9e7 + mPromo(m);
            else if (m === k0) s = 8e7;
            else if (m === k1) s = 7e7;
            else s = this.hist[b.sq[mFrom(m)] * 128 + mTo(m)];
            if (mPromo(m) && mFlags(m) & F_CAPTURE) s += mPromo(m) * 1000;
            keys[i] = s;
        }
        const idx = new Array(n);
        for (let i = 0; i < n; i++) idx[i] = i;
        idx.sort((x, y) => keys[y] - keys[x]);
        const out = new Array(n);
        for (let i = 0; i < n; i++) out[i] = moves[idx[i]];
        return out;
    }
}

/** Counts the leaf nodes of the move tree (tests the move generator). */
function perft(b, depth) {
    if (depth === 0) return 1;
    const ms = b.gen([], false);
    let n = 0;
    for (let i = 0; i < ms.length; i++) {
        if (b.make(ms[i])) n += depth === 1 ? 1 : perft(b, depth - 1);
        b.unmake();
    }
    return n;
}

module.exports = {
    Board, Search, LEVELS, perft, MATE,
    PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING, BLACK, WHITE_SIDE, BLACK_SIDE,
    mFrom, mTo, mPromo, mFlags, sqName, sqOf, colorOf, typeOf, F_CAPTURE, F_CASTLE, F_EP,
};
