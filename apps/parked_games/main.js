'use strict';
/**
 * Parked Games - small games for when the car is parked, all in one app.
 *
 * The shell (this file) owns everything around a game; the games plug in as games/<id>/index.js
 * (the interface: GAMES.md). One canvas screen, MAIN (the kit's display drives one canvas screen
 * with the GPU renderer, touch and the controller), in two modes:
 *   menu  a tile per game (title, line, best score), tapped or chosen with the knob (the kit's
 *         page targets).
 *   game  the round, the whole page. The header's tabs: GAMES (back to the menu, the round paused)
 *         and the game's own (the app has no settings). BACK leaves the app (the round pauses; it
 *         goes on when the app is opened again). While a game is on screen the app holds the controller:
 *         every turn, press and push is the game's, so the knob can't wander onto the header's tabs
 *         and close the game. A long press pauses; the pause card's "Games menu" (turn to it, press)
 *         goes back to the menu.
 *
 * Controls: every game is played with the iDrive knob (turn, press, push N / E / S / W) and the
 * touchscreen. The steering wheel and the pedals are not read at all.
 *
 * Safety: the app plays only while the car stands (vehicle.js). This is always on: there is no
 * setting for it. As soon as the car moves the round pauses and the menu waits until it stops again.
 */
const path = require('path');
const mgu = require('./kit/mgu');
const Parked = require('./kit/parked');
const G = require('./kit/gauges');
const { Vehicle } = require('./vehicle');
const { Controller } = require('./controls');
const { load, Scores, Store } = require('./registry');
const S = require('./style');

const W = 1600, H = 520;
const SLOTS = 10;                                     // games on the menu (two rows of tiles)

const mono = () => { const h = process.hrtime(); return h[0] * 1000 + h[1] / 1e6; };
const fmt = (g, n) => {
    if (n === null || n === undefined) return '-';
    if (g.score && typeof g.score.format === 'function') { try { return String(g.score.format(n)); } catch (e) { /* fall through */ } }
    const s = String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return g.score && g.score.unit ? s + ' ' + g.score.unit : s;
};

mgu.run({
    async start(ctx) {
        const { ui, log } = ctx;
        const games = load(path.join(__dirname, 'games'), log);
        log.info('games: ' + (games.map((g) => g.id).join(', ') || 'none'));
        const scores = new Scores(path.join(ctx.dataDir, 'scores.json'));
        const store = new Store(path.join(ctx.dataDir, 'game-data.json'));

        /* ---------- the car ---------- */
        const parked = Parked.watch(ctx, log);
        const car = new Vehicle();
        const watch = (iface, handlers) => ctx.signals.watch(iface, '1', handlers, log, { pollMs: 2000 })
            .then((s) => log.info(iface.split('.').pop() + ': ' + (s.error ? 'error: ' + s.error : 'subscribed')))
            .catch((e) => log.warn(iface + ': ' + e));
        watch('de.bmw.infotainment.vehicle.Vehicle2', { statusCarSpeed2: (v) => car.speedRaw(v) });
        const state = () => {
            const st = car.state();
            // the kit's own parked check reads the same speed (and re-reads it every 2 s)
            if (parked.moving()) st.moving = true;
            return st;
        };

        /* ---------- a round ---------- */
        let cur = null;          // { g, game, phase: 'play' | 'paused' | 'over', score, place, err }
        const ctl = new Controller();
        function api(g, round) {
            return {
                W, H, log: {
                    info: (...a) => log.info.apply(null, [g.id + ':'].concat(a)),
                    warn: (...a) => log.warn.apply(null, [g.id + ':'].concat(a)),
                    error: (...a) => log.error.apply(null, [g.id + ':'].concat(a)),
                },
                now: mono, random: Math.random, theme: ctx.theme, style: S,
                best: () => scores.best(g.id), top: () => scores.top(g.id),
                store: store.forGame(g.id),
                end(score) {
                    if (cur !== round || round.phase === 'over') return;
                    round.phase = 'over'; round.score = score; round.overAt = mono(); cardSel = 0;
                    round.prevBest = scores.best(g.id);
                    round.place = scores.add(g, score);
                    log.info(g.id + ': round over, ' + fmt(g, score) + (round.place === 1 ? ' (new best)' : ''));
                },
            };
        }
        function newRound(g) {
            const round = { g, game: null, phase: 'play', score: null, place: 0, err: null };
            cur = round;
            try { round.game = g.create(api(g, round)); } catch (e) { fail(round, e); }
            if (!round.game) fail(round, new Error('create() returned nothing'));
            lastT = mono();
            log.info(g.id + ': new round');
        }
        function fail(round, e) {
            log.error(round.g.id + ' stopped', e);
            round.err = e; round.phase = 'over'; round.game = null; round.overAt = mono();
        }
        const call = (fn) => {
            const r = cur;
            if (!r || !r.game) return;
            try { fn(r.game); } catch (e) { fail(r, e); }
        };
        function pause() {
            if (!cur || cur.phase !== 'play') return;
            cur.phase = 'paused'; cardSel = 0;
            call((gm) => gm.pause && gm.pause());
        }
        function resume() {
            if (!cur || cur.phase !== 'paused' || state().moving) return;
            cur.phase = 'play'; lastT = mono();
            call((gm) => gm.resume && gm.resume());
        }
        /** The main action (knob press, tap, the bar button): continue, or play again. */
        function action() {
            if (!cur) return false;
            if (cur.phase === 'paused') { resume(); return true; }
            if (cur.phase === 'over') { newRound(cur.g); return true; }
            return false;
        }

        /* ---------- input ---------- */
        // the card over a paused or ended round: two buttons, 0 = go on / play again, 1 = the games menu
        let cardSel = 0, cardBtns = [];
        const OPEN_QUIET = 600;      // ms after a game opens: the press that opened it is not the game's
        let openedAt = -1e9;
        function input(ev) {
            if (!cur || mode !== 'game' || !shown()) return;
            const knobby = ev.type === 'knob' || ev.type === 'press' || ev.type === 'hold' || ev.type === 'push' || ev.type === 'release';
            if (knobby && mono() - openedAt < OPEN_QUIET) return;
            if (cur.phase !== 'play') {
                if (ev.type === 'knob' && ev.delta) cardSel = ev.delta > 0 ? 1 : 0;
                else if (ev.type === 'push' && (ev.dir === 'E' || ev.dir === 'W')) cardSel = ev.dir === 'E' ? 1 : 0;
                else if (ev.type === 'press') { if (cardSel === 1) toMenu(); else action(); }
                else if (ev.type === 'tap') {
                    const b = cardBtns.find((q) => ev.x >= q.x && ev.x < q.x + q.w && ev.y >= q.y && ev.y < q.y + q.h);
                    if (b && b.i === 1) toMenu(); else action();
                }
                return;
            }
            // a long press: pause (the card then offers the way back to the menu)
            if (ev.type === 'hold') { pause(); cardSel = 0; return; }
            call((gm) => gm.input && gm.input(ev));
        }
        // the controller: while the game holds it the renderer hands on what the HMI didn't get; the
        // app's own FrontCCU copy is the fallback (as in the kit's Doom)
        let ccuT = 0;
        const feed = (v) => ctl.feed(v).forEach(input);
        if (ctx.controller && ctx.controller.onInput) ctx.controller.onInput((v) => { ccuT = Date.now(); feed(v); });
        watch('de.bmw.infotainment.controlelements.FrontCCU', { statusRotaryEncoderState: (v) => { if (Date.now() - ccuT > 1000) feed(v); } });
        const PH = { 1: 'down', 2: 'move', 3: 'up' };
        if (ctx.onTouch) ctx.onTouch((phase, x, y) => { if (PH[phase]) input({ type: 'touch', phase: PH[phase], x, y }); });
        ctx.onTap((x, y) => input({ type: 'tap', x, y }));

        /* ---------- the menu: a tile per game (the kit's page targets: tap, or turn and press) ---------- */
        let sel = 0, mode = 'menu';
        function open(g) {
            if (state().moving) return;
            sel = games.indexOf(g);
            if (!(cur && cur.g === g && cur.phase !== 'over')) newRound(g);
            mode = 'game'; lastT = mono(); openedAt = mono(); cardSel = 0;
        }
        function toMenu() { pause(); mode = 'menu'; }
        // the header's tabs: 0 = GAMES (the menu), 1 = the round's game
        ctx.onTab((i) => { if (i === 0) toMenu(); else if (i === 1 && cur && !state().moving && mode !== 'game') { mode = 'game'; lastT = mono(); openedAt = mono(); } });
        const tabs = () => ['Games'].concat(cur ? [cur.g.title] : []);
        const lift = {};          // per tile: 0..1, eased towards selected
        let menuT0 = mono(), lastMenu = mono();
        /** One chip over the tiles: how to play, or why the games wait. */
        function statusChips(cv, st, y) {
            if (st.moving) { S.chip(cv, 'Parked only: the games wait while the car moves', 24, y, S.P.warn, { size: 15 }); return; }
            S.chip(cv, 'Every game plays with the iDrive knob: turn, press and push', 24, y, S.P.dim, { size: 15 });
        }
        function drawMenu() {
            const t = ctx.theme(), st = state(), now = mono(), dt = Math.min(50, now - lastMenu);
            lastMenu = now;
            const cv = ctx.canvas(W, H).clear(S.P.bg0);
            G.frame(cv, t, tabs(), 0);
            const top = G.TOP, bottom = G.pageBottom(cv) - 8;
            const selHue = games[sel] ? S.hue(games[sel].id) : S.P.cold;
            S.backdrop(cv, 0, top, W, H - top, { tint: selHue, grid: 48, sx: (now - menuT0) * 0.012, horizon: 1 });
            statusChips(cv, st, top + 10);
            if (!games.length) { cv.text('No games installed', W / 2, (top + bottom) / 2, 32, S.P.dim, { align: 'center', font: 'bold' }); return ui.image('MAIN_GFX', cv); }
            const n = Math.min(games.length, SLOTS), cols = n <= 6 ? 3 : n <= 8 ? 4 : 5, rows = Math.ceil(n / cols);
            const gx = 24, gy = top + 52, gap = 18;
            const tw = (W - 2 * gx - gap * (cols - 1)) / cols, th = Math.min(200, (bottom - gy - gap * (rows - 1)) / rows);
            games.slice(0, SLOTS).forEach((g, i) => {
                const hue = S.hue(g.id), on = i === sel;
                lift[g.id] = S.approach(lift[g.id] || 0, on ? 1 : 0, dt, 0.55);
                const k = lift[g.id];
                const x = gx + (i % cols) * (tw + gap), y = gy + Math.floor(i / cols) * (th + gap) - 4 * k;
                const going = cur && cur.g === g && cur.phase === 'paused';
                S.panel(cv, x, y, tw, th, { r: 18, accent: hue, glow: k * (0.75 + 0.25 * S.ease.pulse(now, 1600)), bar: false });
                // the art: the game's own little scene, in its hue, on the left
                const aw = Math.round(th * 1.0), ax = x + 8, ay = y + 8, ah = th - 16;
                cv.clip(ax, ay, aw, ah);
                cv.card(ax, ay, aw, ah, 12, [[0, S.mix(hue, S.P.bg1, 0.82)], [1, S.mix(hue, S.P.bg0, 0.93)]]);
                try { if (typeof g.art === 'function') g.art(cv, ax, ay, aw, ah, S, now - menuT0); else S.glowCircle(cv, ax + aw / 2, ay + ah / 2, ah * 0.18, hue); } catch (e) { /* art is decoration */ }
                cv.noclip();
                cv.strokeRoundRect(ax, ay, aw, ah, 12, 1, S.a(hue, 0.25 + 0.35 * k));
                // the words, right of the art
                const tx = ax + aw + 22, tr = x + tw - 18;
                cv.clip(tx, y, tr - tx, th);
                cv.text(g.title, tx, y + 50, 30, st.moving ? S.P.dim : S.P.ink, { font: 'bold' });
                if (g.blurb) cv.text(g.blurb, tx, y + 80, 18, S.P.dim, { font: 'label' });
                cv.noclip();
                const b = scores.best(g.id);
                if (b === null) S.label(cv, 'New', tx, y + th - 26, S.P.faint, { size: 15 });
                else {
                    S.label(cv, 'Best', tx, y + th - 56, S.P.dim, { size: 13 });
                    cv.text(fmt(g, b), tx, y + th - 22, 30, hue, { font: 'bold' });
                }
                if (going) S.chip(cv, 'Paused', tr, y + 16, S.P.gold, { align: 'right', solid: true, size: 13 });
                cv.target(x, y, tw, th, () => open(g), g.id, 18);
            });
            S.vignette(cv, 0, top, W, H - top, 0.5);
            return ui.image('MAIN_GFX', cv);
        }
        if (games.length > SLOTS) log.warn('only the first ' + SLOTS + ' games fit the menu');

        /* ---------- run while the game is on screen ---------- */
        const shown = () => ui.isVisible('MAIN') && !ui.isVisible('SETTINGS') && (!ui.hasFocus || ui.hasFocus('MAIN'));
        let grabbed = false;
        function sync() {
            const st = state();
            if (st.moving && cur && cur.phase === 'play') { pause(); log.info('car moving: paused'); }
            if (st.moving && mode === 'game') mode = 'menu';
            if (!shown()) pause();
            const want = shown() && mode === 'game' && !st.moving;
            if (want !== grabbed) { grabbed = want; if (ctx.controller) ctx.controller.grab(want); }
        }
        setInterval(sync, 200);
        if (ui.onFocus) ui.onFocus(() => sync());

        /* ---------- drawing ---------- */
        let lastT = mono();
        function render() {
            if (mode !== 'game' || !cur) return drawMenu();
            const t = ctx.theme();
            const cv = ctx.canvas(W, H).clear(S.P.bg0);
            G.frame(cv, t, tabs(), 1);         // the header's tabs (full-screen layout: drawn in the header, not on the page)
            const now = mono(), dt = Math.min(50, Math.max(0, now - lastT));
            lastT = now;
            if (cur.phase === 'play') call((gm) => gm.update(dt));
            call((gm) => gm.draw(cv));
            if (cur.phase === 'paused') { cur.pausedAt = cur.pausedAt || mono(); paused(cv, t); } else {
                cur.pausedAt = 0;
                if (cur.phase === 'over') result(cv, t);
            }
            return ui.image('MAIN_GFX', cv);
        }
        /** The card over a paused or ended round: the round dims and blurs back, the card springs in. */
        function card(cv, w, h, since) {
            const f = S.ease.out((mono() - since) / 260), sc = 0.94 + 0.06 * S.ease.back((mono() - since) / 320);
            cv.fillRect(0, 0, W, H, [3, 5, 12, Math.round(185 * f)]);
            const hue = S.hue(cur.g.id);
            const cw = w * sc, ch = h * sc, x = (W - cw) / 2, y = (H - ch) / 2 + 18 + 20 * (1 - f);
            cv.alpha(f);
            S.panel(cv, x, y, cw, ch, { r: 22, accent: hue, glow: 0.6, barW: 96 });
            return { x, y, w: cw, h: ch, hue, f };
        }
        /** The card's two buttons at its bottom: go on (or play again) and the games menu; the knob's one lit */
        function buttons(cv, p, first) {
            const bw = 280, bh = 52, gap = 28, y = p.y + p.h - bh - 30, x0 = W / 2 - bw - gap / 2;
            cardBtns = [first, 'Games menu'].map((s, i) => {
                const x = x0 + i * (bw + gap), on = i === cardSel;
                const glow = on ? 0.7 + 0.3 * S.ease.pulse(mono(), 1400) : 0;
                cv.roundRect(x, y, bw, bh, bh / 2, on ? S.a(p.hue, 0.22 + 0.12 * glow) : [255, 255, 255, 14]);
                cv.strokeRoundRect(x, y, bw, bh, bh / 2, on ? 2 : 1.2, on ? p.hue : S.a(S.P.dim, 0.5));
                cv.text(s, x + bw / 2, y + bh / 2 + 8, 22, on ? S.P.ink : S.P.dim, { align: 'center', font: 'bold' });
                return { i, x, y, w: bw, h: bh };
            });
            cv.text('Turn the knob to choose, press (or tap)', W / 2, p.y + p.h - 10, 14, S.P.faint, { align: 'center', font: 'label' });
        }
        function paused(cv, t) {
            const p = card(cv, 760, 270, cur.pausedAt);
            S.label(cv, cur.g.title, W / 2, p.y + 52, p.hue, { align: 'center', size: 15 });
            cv.text('Paused', W / 2, p.y + 108, 44, S.P.ink, { align: 'center', font: 'bold' });
            if (state().moving) { cardBtns = []; cv.text('Stop the car to play', W / 2, p.y + 150, 22, S.P.warn, { align: 'center', font: 'label' }); cv.alpha(1); return; }
            buttons(cv, p, 'Go on');
            cv.alpha(1);
        }
        function result(cv, t) {
            const g = cur.g, since = cur.overAt || mono();
            const p = card(cv, 900, 400, since);
            if (cur.err) {
                cv.text(g.title + ' stopped', W / 2, p.y + 100, 40, S.P.bad, { align: 'center', font: 'bold' });
                cv.text(String(cur.err.message || cur.err).slice(0, 70), W / 2, p.y + 160, 22, S.P.dim, { align: 'center', font: 'label' });
                buttons(cv, p, 'Try again');
                cv.alpha(1);
                return;
            }
            const best = cur.place === 1, age = mono() - since, lx = p.x + 56;
            S.label(cv, g.title, lx, p.y + 54, p.hue, { size: 15 });
            if (best) {
                const cw = S.chip(cv, 'New best', lx, p.y + 72, S.P.gold, { solid: true, size: 15 });
                // a light sweep across the chip
                const sx = ((age % 1600) / 1600) * (cw + 80) - 40;
                cv.clip(lx, p.y + 72, cw, 28); cv.quad([[lx + sx, p.y + 72], [lx + sx + 18, p.y + 72], [lx + sx + 6, p.y + 100], [lx + sx - 12, p.y + 100]], [255, 255, 255, 70]); cv.noclip();
            } else cv.text('Round over', lx, p.y + 96, 28, S.P.ink, { font: 'bold' });
            // the score counts up and lands with a pop
            const up = S.ease.out(age / 900), shown = typeof cur.score === 'number' ? cur.score * up : cur.score;
            const big = (g.score && typeof g.score.format === 'function') ? null : fmt(Object.assign({}, g, { score: {} }), shown);
            const pop = 1 + 0.08 * Math.max(0, 1 - Math.abs(age - 950) / 160);
            const col = best ? S.P.gold : S.P.ink;
            if (big !== null && /^[0-9 .,:-]+$/.test(big)) {
                const size = Math.round(96 * pop);
                cv.text(big, lx, p.y + 210, size, S.a(best ? S.P.gold : p.hue, 0.22), { font: 'num' });
                const bw = cv.text(big, lx, p.y + 208, size, col, { font: 'num' });
                if (g.score && g.score.unit) cv.text(g.score.unit, lx + bw + 14, p.y + 208, 32, S.P.dim, { font: 'bold' });
            } else cv.text(fmt(g, cur.score), lx, p.y + 200, 44, col, { font: 'bold' });
            if (!best && cur.prevBest !== null) { S.label(cv, 'Best', lx, p.y + 262, S.P.dim, { size: 13 }); cv.text(fmt(g, cur.prevBest), lx + 58, p.y + 263, 22, S.P.ink, { font: 'bold' }); }
            // the top list, right: rows slide in one after another, each with a bar against the best
            const top = scores.top(g.id), rx = p.x + p.w - 360, rw = 300;
            S.label(cv, 'Top ' + top.length, rx, p.y + 54, S.P.dim, { size: 15 });
            const vmax = top.reduce((m, e) => Math.max(m, Math.abs(e.score)), 1), lower = g.score && g.score.lower;
            top.forEach((e, i) => {
                const rf = S.ease.out((age - 150 - i * 70) / 300);
                if (rf <= 0) return;
                const mine = i + 1 === cur.place, ry = p.y + 78 + i * 46;
                cv.alpha(p.f * rf);
                if (mine) cv.roundRect(rx - 12, ry, rw + 24, 40, 10, S.a(p.hue, 0.16));
                cv.text(String(i + 1), rx, ry + 28, 20, mine ? p.hue : S.P.faint, { font: 'bold' });
                cv.text(fmt(g, e.score), rx + 34, ry + 28, 22, mine ? S.P.ink : S.P.dim, { font: 'bold' });
                const k = lower ? (top[0].score / Math.max(1e-9, e.score)) : Math.abs(e.score) / vmax;
                S.meter(cv, rx + 170, ry + 16, (rw - 170) * rf, 8, k, mine ? p.hue : S.P.faint);
                cv.alpha(p.f);
            });
            buttons(cv, p, 'Play again');
            cv.alpha(1);
        }
        ctx.loop('MAIN', 30, render);
        log.info('parked games started');
    },
});
