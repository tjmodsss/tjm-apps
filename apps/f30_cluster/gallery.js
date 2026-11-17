'use strict';
/**
 * gallery.js - the theme gallery: every cluster theme with its picture, on a drawn (canvas) screen GALLERY behind the
 * native menu's "Theme gallery" button (menu.js). What is left of the drawn page (page.js, retired 2026-11-14): BMW's
 * own list rows can't show several pictures, so the pictures stay drawn here. Everything else is native now.
 *
 * Drawn on the kit's canvas screen (kit/runtime/display.js): on the Store's renderer a tap or a controller press on a
 * card shows that theme (in the drive mode the car is in, when the theme changes with it); without the renderer the
 * HMI shows the same drawing as a picture, and the bar's "Next theme" steps through them. "Done" goes back.
 * A pick sets the setting only; menu.js's settings listener takes the shared screen (screen.js) when the cluster then
 * draws a theme. Theme pictures: previews.js. Plain Node 8 (the car's 8.16.2).
 */
const G = require('./kit/gauges');
const themes = require('./kit/themes');
const previews = require('./previews');
const Menu = require('./menu');

const W = 1600, H = 520;
const A = G.withAlpha;
const C = {
    bg: '#05070a', glow: '#0d1a2e', text: '#eef2f8', dim: '#8a96a8', label: '#6f7b8f', line: '#ffffff12',
    blue: '#2b7fff', blueHi: '#5aa2ff', blueDeep: '#1c69d4',
};
const X0 = 24, X1 = W - 24;
const MODES = [['inComfort', 'Comfort'], ['inSport', 'Sport'], ['inEco', 'Eco Pro']];

// the kit's own chrome (header, bar) in BMW blue, to match
Object.assign(themes.THEMES.m_tricolour, { sel: C.blue, selText: '#ffffff', accent2: C.blueHi, bg: C.bg });

class Gallery {
    /** cfg: { tags: { layout: 'tag line' } } */
    constructor(ctx, hud, cfg) {
        this.ctx = ctx; this.hud = hud; this.cfg = cfg || {};
        this.loop = null;
    }

    guard(what, fn) {
        try { return fn(); } catch (e) { this.ctx.log.error('gallery ' + what + ': ' + (e && e.stack || e)); return undefined; }
    }

    start() {
        const ctx = this.ctx;
        this.loop = ctx.loop('GALLERY', 10, () => this.render());
        ctx.settings.onChange(() => this.kick());
        ctx.onLayout(() => this.kick());
        this.hud.onStatus(() => this.kick());
        ctx.ui.onClick('BTN_NEXT_THEME', () => this.guard('next', () => this.next()));
        ctx.ui.onClick('BTN_GALLERY_DONE', () => this.guard('done', () => ctx.ui.close('GALLERY')));
    }
    kick() { if (this.loop && this.loop.kick) this.loop.kick(); }

    get(k) { return this.hud.setting(k); }
    name(v) { return Menu.layoutName(this.ctx.settings, v); }
    tag(v) { return v === 'off' ? 'stock cluster' : (this.cfg.tags || {})[v] || ''; }
    /** the themes a card can show (not the calibration ones): the drive-mode settings' choices */
    looks() { return ((this.ctx.settings.item('inSport') || {}).options || []).map((o) => o[0]); }

    /** Show theme v: in the setting a pick goes to now (Menu.lookKey); the same one again takes the screen back. */
    choose(v) {
        const key = Menu.lookKey(this.hud), st = this.ctx.settings, scr = this.hud.screen;
        if (st.get(key) !== v) st.set(key, v);
        else if (scr && scr.yielded) scr.claim();
        this.kick();
    }
    /** "Next theme" on the bar: the one after the one picked now, round. */
    next() {
        const list = this.looks();
        if (!list.length) return;
        const i = list.indexOf(this.get(Menu.lookKey(this.hud)));
        this.choose(list[(i + 1) % list.length]);
    }

    render() {
        const cv = this.ctx.canvas(W, H);
        this.guard('draw', () => this.draw(cv));
        return this.ctx.ui.image('GALLERY_GFX', cv);
    }

    draw(cv) {
        const bottom = G.pageBottom(cv), hud = this.hud;
        cv.clear(C.bg);
        cv.gradientRect(0, 0, W, bottom + 8, [[0, C.glow], [0.55, '#070a10'], [1, C.bg]]);
        const on = hud.activeName && hud.activeName !== 'off';
        const demo = hud.car && hud.car.data().demo;
        G.frame(cv, this.ctx.theme(), [], -1, [
            demo ? { text: 'DEMO DATA', color: '#ffb020' } : null,
            { text: on ? 'ON THE CLUSTER' : 'CLUSTER OFF', color: on ? '#3ddc84' : C.dim },
        ]);
        // the cards are themes, so a see-through file showing ("+ G20", the g20 toggle) selects its own theme's card
        const key = Menu.lookKey(hud), shown = Menu.themeOf(Menu.shownName(hud)), byMode = this.get('byMode') === true;
        const where = key === 'hudLayout'
            ? (byMode ? 'Tap a theme: it shows until the car sends its drive mode (Theme)' : 'Tap a theme to show it in every drive mode')
            : 'Tap a theme to show it in ' + Menu.MODE_NAME[hud.driveMode] + ' (the drive mode now)';
        const scr = hud.screen;
        const note = scr && scr.yielded ? 'Off: ' + scr.otherName + ' has the screen. Tap a theme to take it back' : where;
        label(cv, X0, 70, note, scr && scr.yielded ? '#e0a340' : C.label);
        // the cards, two rows
        const looks = this.looks(), cols = Math.max(4, Math.ceil(looks.length / 2)), gap = 14, y0 = 86;
        const cw = (X1 - X0 - gap * (cols - 1)) / cols, ch = (bottom - y0 - 4 - gap) / 2;
        looks.forEach((v, i) => {
            const x = X0 + (i % cols) * (cw + gap), y = y0 + Math.floor(i / cols) * (ch + gap), sel = v === shown;
            glass(cv, x, y, cw, ch, sel);
            const ih = Math.min(ch - 70, (cw - 20) * 0.375), iw = ih / 0.375;
            this.picture(cv, v, x + (cw - iw) / 2, y + 10, iw, ih);
            const ty = y + 10 + ih + 26;
            cv.text(this.name(v), x + 14, ty, 18, '#ffffff', { font: 'bold', literal: true });
            cv.text(this.tag(v), x + cw - 14, ty, 13, C.dim, { align: 'right', literal: true });
            // the drive modes that show it
            const modes = byMode ? MODES.filter((m) => this.get(m[0]) === v).map((m) => m[1]) : [];
            const sub = byMode ? (modes.length ? 'In ' + modes.join(', ') : '') : (this.get('hudLayout') === v ? 'In every drive mode' : '');
            if (sub) cv.text(sub, x + 14, ty + 24, 14, C.blueHi, { literal: true });
            cv.target(x, y, cw, ch, () => this.guard('pick', () => this.choose(v)), 'look:' + v, 16);
        });
    }

    /** A theme's picture (its name on black when there is none: BMW's own, or a build without previews). */
    picture(cv, name, x, y, w, h) {
        cv.roundRect(x, y, w, h, 10, '#000000');
        const p = name !== 'off' && previews.get(name, 'small');
        if (p) cv.image(p.id, x, y, w, h);
        else cv.text(this.name(name), x + w / 2, y + h / 2 + 7, 18, C.dim, { align: 'center', literal: true });
        cv.strokeRoundRect(x, y, w, h, 10, 1, '#ffffff10');
    }
}

function label(cv, x, y, s, c) { cv.text(s.toUpperCase(), x, y, 14, c || C.label, { font: 'bold', spacing: 2.4, literal: true }); }
function glass(cv, x, y, w, h, sel) {
    if (sel) {
        cv.card(x, y, w, h, 16, [[0, A(C.blue, 0.16)], [1, A(C.blueDeep, 0.05)]]);
        cv.strokeRoundRect(x, y, w, h, 16, 2, C.blue);
    } else {
        cv.card(x, y, w, h, 16, [[0, '#ffffff0b'], [1, '#ffffff04']]);
        cv.strokeRoundRect(x, y, w, h, 16, 1, C.line);
    }
}

module.exports = Gallery;
