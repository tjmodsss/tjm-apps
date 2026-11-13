'use strict';
/**
 * Brick Breaker - a Parked Games game (interface: apps/parked_games/GAMES.md).
 *
 * Played sideways for the wide iDrive screen: your paddle slides up and down the left edge,
 * a wall of bricks stands on the right. Clear every breakable brick to reach the next level;
 * the eight layouts repeat after the last one, faster each time round. Three lives.
 *
 * Controls
 *   turn the iDrive knob            move the paddle (clockwise = down, as in a list)
 *   push the controller up / down   move it a long way
 *   press (or push right)           launch the ball / skip the level banner
 *   touch                           drag a finger anywhere to move the paddle; a tap puts it
 *                                   there, and launches a waiting ball
 *
 * Bricks: green 1 hit, amber 2, red 3, grey steel never breaks, purple star always drops a power-up.
 * Power-ups (catch them with the paddle): W wide paddle, M multi-ball, S slow ball, + extra life.
 */
const { Engine } = require('./engine');
const D = require('./draw');
const look = require('./look');

const RECT = { x: 0, y: 0, w: D.W, h: D.H };
const QUIET = { info() {}, warn() {}, error() {} };

class Game {
    constructor(api) {
        this.api = api || {};
        this.log = this.api.log || QUIET;
        const seed = this.api.seed != null ? this.api.seed
            : this.api.random ? Math.floor(this.api.random() * 4294967296) : Date.now();
        this.g = new Engine({ seed });
        this.paused = false;
        this.ended = false;
        this.toast = { text: '', ms: 0, color: null };
        this.fx = this.api.style ? new look.Fx(this.api.style) : null;
    }

    /** canvas px -> field y */
    fieldY(y) { const f = D.fit(RECT); return (y - f.oy) / f.s - D.HUD; }

    events() {
        const g = this.g;
        for (const e of g.takeEvents()) {
            if (this.fx) this.fx.event(e, g);
            if (e.type === 'power') Object.assign(this.toast, { text: D.POWER_NAME[e.kind], color: D.C.power[e.kind], ms: 1400 });
            else if (e.type === 'clear') {
                Object.assign(this.toast, { text: 'Level ' + e.level + ' cleared', color: null, ms: 1400 });
                this.log.info('brick breaker: level ' + e.level + ' cleared, score ' + g.score);
            } else if (e.type === 'over' && !this.ended) {
                this.ended = true;
                this.log.info('brick breaker: game over on level ' + (g.level + 1) + ', score ' + e.score);
                if (this.api.end) this.api.end(e.score);
            }
        }
    }

    update(dt) {
        if (this.paused || this.ended) return;
        this.g.step(dt);
        if (this.fx) this.fx.update(dt, this.g);
        if (this.toast.ms > 0) this.toast.ms = Math.max(0, this.toast.ms - dt);
        this.events();
    }

    draw(cv) {
        const best = this.api.best ? this.api.best() : null;
        const view = { best: best || 0, toast: this.toast, ended: this.ended };
        if (this.fx) look.draw(cv, this.g, this.api.style, this.fx, view);
        else D.draw(cv, RECT, this.g, view);
    }

    input(ev) {
        const g = this.g;
        if (!ev || this.paused || this.ended) return;
        switch (ev.type) {
            case 'knob': if (ev.delta) g.move(ev.delta); break;
            case 'press': g.action(); break;
            case 'push':
                if (ev.dir === 'N' || ev.dir === 'S') g.nudge(ev.dir);
                else if (ev.dir === 'E') g.action();
                break;
            case 'touch':
                if (ev.phase === 'down' || ev.phase === 'move') g.aim(this.fieldY(ev.y));
                break;
            case 'tap':
                g.aim(this.fieldY(ev.y));
                if (g.state === 'serve' || g.banner > 0) g.action();
                break;
            default: break;
        }
        this.events();
    }

    pause() { this.paused = true; }
    resume() { this.paused = false; }

    /** (tests) */
    status() { const g = this.g; return { score: g.score, over: g.over, level: g.level + 1, lives: g.lives }; }
}

module.exports = {
    id: 'brick-breaker',
    title: 'Brick Breaker',
    blurb: 'Smash the wall of bricks',
    order: 50,
    needs: [],
    score: { unit: 'pts', lower: false },
    art: look.art,
    create(api) { return new Game(api); },
    Game,
};
