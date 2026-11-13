'use strict';
/**
 * Paddle Duel: the Parked Games plug-in (interface: apps/parked_games/GAMES.md).
 * The rules and the drawing are in game.js; this file maps the shell's inputs onto the two paddles.
 *
 * First a setup card: the opponent (the car, at Easy / Normal / Hard, or 2 players: one on the knob,
 * the other on the touchscreen) and the knob's side (left or right), all remembered in the game's
 * store. Turn the knob to a row, press (or push left / right) to change it, Start; or tap.
 *
 * You play your paddle with the iDrive knob (each click moves it, push up / down slides it), or with a
 * finger on your half of the screen. Against the car, a second player can still take the car's paddle
 * by touching the other half: then it's a duel. Pushing the controller right (or left) before the
 * first serve moves the knob's paddle to that side.
 *
 * Score for the high-score table: the longest rally of the match (hits).
 */
const { PaddleDuel, COURT, PADDLE } = require('./game');
const look = require('./draw');

const POINTS = 7;
const LEVELS = ['easy', 'normal', 'hard'];

class Game {
    constructor(api) {
        this.api = api;
        const store = api.store || { get() {}, set() {} };
        this.store = store;
        this.side = store.get('side') === 'R' ? 'R' : 'L';
        this.two = store.get('two') === true;               // 2 players (knob vs touch), else against the car
        this.level = LEVELS.indexOf(store.get('level')) >= 0 ? store.get('level') : 'normal';
        this.joined = false;          // a second player has the other paddle by touch
        this.ended = false;
        this.setup = true;            // the setup card before the match
        this.row = 0;
        this.g = new PaddleDuel({ target: POINTS, cpu: this.level, random: api.random || Math.random, left: 'cpu', right: 'cpu' });
        this.assign();
        this.fx = api.style ? new look.Fx(api.style) : null;
    }

    /* ---------- the setup card ---------- */
    rows() { return this.two ? ['opp', 'side', 'start'] : ['opp', 'level', 'side', 'start']; }
    choices(row) {
        if (row === 'opp') return { label: 'Opponent', opts: ['Car', '2 players'], i: this.two ? 1 : 0 };
        if (row === 'level') return { label: 'Car level', opts: ['Easy', 'Normal', 'Hard'], i: LEVELS.indexOf(this.level) };
        if (row === 'side') return { label: 'Knob plays', opts: ['Left', 'Right'], i: this.side === 'R' ? 1 : 0, note: this.two ? 'touch plays the ' + (this.side === 'R' ? 'left' : 'right') : null };
        return null;
    }
    choose(row, i) {
        if (row === 'opp') { this.two = i === 1; this.store.set('two', this.two); }
        else if (row === 'level') { this.level = LEVELS[(i + 3) % 3]; this.store.set('level', this.level); }
        else if (row === 'side') { this.side = i === 1 ? 'R' : 'L'; this.store.set('side', this.side); }
        this.row = Math.max(0, Math.min(this.rows().length - 1, this.row));
        this.g.o.cpu = this.level;
        this.assign();
    }
    /** the match begins with the setup's choices */
    start() {
        this.setup = false;
        this.joined = this.two;
        this.g.o.cpu = this.level;
        this.assign();
        this.g.newMatch();
    }
    setupInput(ev) {
        const rows = this.rows(), n = rows.length;
        if (ev.type === 'knob' && ev.delta) { this.row = Math.max(0, Math.min(n - 1, this.row + (ev.delta > 0 ? 1 : -1))); return; }
        if (ev.type === 'push' && (ev.dir === 'N' || ev.dir === 'S')) { this.row = Math.max(0, Math.min(n - 1, this.row + (ev.dir === 'S' ? 1 : -1))); return; }
        const row = rows[this.row], ch = this.choices(row);
        if (ev.type === 'push' && ch) { this.choose(row, (ch.i + (ev.dir === 'E' ? 1 : -1) + ch.opts.length) % ch.opts.length); return; }
        if (ev.type === 'press') { if (row === 'start') this.start(); else if (ch) this.choose(row, (ch.i + 1) % ch.opts.length); return; }
        if ((ev.type === 'touch' && ev.phase === 'up') || ev.type === 'tap') {
            if (ev.type === 'tap') return;           // (the kit sends a tap after the touch's up)
            const hit = look.setupHit(this, ev.x, ev.y);
            if (!hit) return;
            this.row = rows.indexOf(hit.row);
            if (hit.row === 'start') this.start();
            else if (hit.opt >= 0) this.choose(hit.row, hit.opt);
        }
    }

    get other() { return this.side === 'L' ? 'R' : 'L'; }

    /** who plays which side */
    assign() {
        const g = this.g, me = this.side, o = this.other, names = {};
        const two = this.joined || (this.setup && this.two);      // (on the setup card: as chosen)
        const oc = two ? 'touch' : 'cpu';
        g.applyLevel();
        names[me] = two ? 'PLAYER 1  ·  KNOB' : 'YOU  ·  KNOB / TOUCH';
        names[o] = two ? 'PLAYER 2  ·  TOUCH' : 'CAR  ·  TOUCH HERE TO PLAY';
        g.hint = two ? null : 'Turn the knob or drag on your half to move your paddle   ·   push up / down to slide it';
        if (g[me].ctl !== 'knob') g.setControl(me, 'knob');
        if (g[o].ctl !== oc) g.setControl(o, oc);
        g.o.left = g.L.ctl; g.o.right = g.R.ctl;
        g.names = names;
    }

    update(dtMs) {
        if (this.ended) return;
        if (this.setup) { this.g.t += dtMs / 1000; if (this.fx) this.fx.update(dtMs); return; }
        this.g.update(dtMs / 1000);
        if (this.fx) this.fx.update(dtMs);
        this.g.takeEvents().forEach((e) => {
            if (this.fx) this.fx.event(e, this.g);
            if (e[0] !== 'over' || this.ended) return;
            this.ended = true;
            const r = this.g.result();
            if (this.api.log) this.api.log.info('paddle duel: ' + r.L + ':' + r.R + ' (' + this.g.winnerName() + ' wins), longest rally ' + r.longestRally);
            if (this.api.end) this.api.end(r.longestRally);
        });
    }

    draw(cv) {
        if (this.fx) { look.draw(cv, this.g, this.api.style, this.fx); if (this.setup) look.drawSetup(cv, this, this.api.style); }
        else this.g.draw(cv, this.api.theme ? this.api.theme() : {});
    }

    input(ev) {
        if (!ev || this.ended || this.g.paused) return;
        if (this.setup) { this.setupInput(ev); return; }
        const g = this.g;
        switch (ev.type) {
            case 'knob':
                g.knob(ev.delta || 0);
                break;
            case 'push':
                if (ev.dir === 'W' || ev.dir === 'E') { this.swapSides(ev.dir === 'W' ? 'L' : 'R'); return; }
                g.tilt(ev.dir);
                break;
            case 'release':
                g.tilt(null);
                break;
            case 'touch': {
                if (ev.phase === 'up' || ev.y < COURT.top - 20) return;
                // alone, a finger on your own half moves your paddle too. A finger on the other half
                // takes (and moves) the car's paddle: a second player on touch, you stay on the knob
                // (and then your half no longer answers touch, so player 2 can't move your paddle)
                const me = this.side, o = this.other, mine = me === 'L' ? ev.x < 800 : ev.x >= 800;
                if (mine) { if (!this.joined) g[me].setTarget(ev.y); break; }
                if (!this.joined) { this.joined = true; this.assign(); }
                g[o].setTarget(ev.y);
                break;
            }
            default:
                break;
        }
    }

    /** before the first serve: put your (knob) paddle on side s ('L' / 'R') */
    swapSides(s) {
        const g = this.g;
        if (s === this.side || g.hits > 0 || g.L.score + g.R.score > 0) return;
        this.side = s;
        this.store.set('side', s);
        this.assign();
    }

    pause() { this.g.pause(true); this.g.tilt(null); }
    resume() { this.g.pause(false); }
}

module.exports = {
    id: 'paddle-duel',
    title: 'Paddle Duel',
    blurb: 'Vs the car, or 2 players',
    order: 20,
    needs: [],
    score: { unit: 'hits', lower: false },
    art: look.art,
    create(api) { return new Game(api); },
    Game,
    PADDLE,
};
