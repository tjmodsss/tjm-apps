'use strict';
/**
 * menu.js - the app's centre screen as BMW's own (native RHMI) widgets: the "menu" screen MAIN of app.json, which the
 * kit generates (kit/tools/build.py) and wires (kit/runtime/mgu.js wireSettings: every setting's checkbox / drop-down).
 * Since 2026-11-14 in place of the drawn page (page.js, retired). This file fills the rows the kit doesn't:
 *
 *   NOW_GFX      graphic   the picture of the theme showing (previews.js, pushed as a PNG like a canvas screen's)
 *   NOW          tworow    its name / tag line and which drive mode picked it; a press opens the gallery (or takes
 *                          the screen back while the other app has it)
 *   SET_BYMODE, SET_HUDLAYOUT, SET_G20, SET_INCOMFORT, SET_INSPORT, SET_INECO   the kit's own rows, placed up here
 *                          (app.json items ["setting", key]); the three drive-mode rows hidden while byMode is off
 *                          (config.menu.hideModeRows), and in the Settings list SET_BOTTOMROW hidden while the G20
 *                          toggle is off (config.menu.hideRowUnlessG20)
 *   STATUS, STATUS2  text  on / off and why, the drive mode seen, the own-row line, problems (from hud.js)
 *   BTN_GALLERY  button    opens the drawn gallery (gallery.js, canvas screen GALLERY)
 *   ...the other settings (the kit's)
 *   STATUS_LOG   text      the engine's whole status line (hud.js _status), for checking on the car
 *
 * The shared screen (screen.js): the drawn page asked "HUD Widgets is on, turn it off?" before taking it. RHMI pop-ups
 * are not something the kit can make, so here a theme picked anywhere (a drop-down, the checkbox, the gallery) takes the
 * screen when the cluster then draws one: HUD Widgets steps aside on its next read, and STATUS2 says it was turned off.
 *
 * Every handler runs inside guard(): an exception that escaped would end the app, and the car's crash handler uninstalls
 * an app after its second crash. Plain Node 8 (the car's 8.16.2).
 */
const { Canvas } = require('./kit/canvas');
const previews = require('./previews');
const HudApp = require('./hud');

const LOOK_KEYS = ['hudLayout', 'inComfort', 'inSport', 'inEco', 'g20'];
const MODE_KEY = { comfort: 'inComfort', sport: 'inSport', eco: 'inEco' };
const MODE_NAME = { comfort: 'Comfort', sport: 'Sport', eco: 'Eco Pro' };
const MODE_ROWS = ['SET_INCOMFORT', 'SET_INSPORT', 'SET_INECO'];
// the one bottom-row setting's row, hidden while the G20 toggle is off (config.menu.hideRowUnlessG20): with G20 off
// our own background covers BMW's row, so there is nothing to choose
const ROW_ROW = 'SET_' + HudApp.ROW_KEY.toUpperCase();
const NOTE_MS = 5 * 60 * 1000;          // how long STATUS2 says the other app was turned off
const PIC_BG = '#05070a';

/** A layout's short name: "Off (BMW's own cluster)" -> "BMW's own cluster". A see-through layout file is named by its
 *  theme plus " + G20" ("6WB Comfort + G20"), since "+ G20" is a toggle and no longer a theme of its own. */
function layoutName(settings, v) {
    if (v === 'off') return "BMW's own cluster";
    const theme = HudApp.themeOf(v);
    const s = settings.item('hudLayout'), o = s && (s.options || []).find((x) => x[0] === theme);
    return (o ? o[1] : String(theme)) + (theme !== v ? ' + G20' : '');
}
/** The setting a theme picked in the gallery goes to: the drive mode's own while the theme changes with it. */
function lookKey(hud) {
    return hud.setting('byMode') === true && MODE_KEY[hud.driveMode] ? MODE_KEY[hud.driveMode] : 'hudLayout';
}
/** The layout showing now, else the one meant to (before cluster-render answers). */
function shownName(hud) {
    return hud.activeName || hud._layoutName() || 'off';
}

class Menu {
    /** cfg: { tags: { layout: 'tag line' } } */
    constructor(ctx, hud, cfg) {
        this.ctx = ctx; this.ui = ctx.ui; this.hud = hud; this.cfg = cfg || {};
        this.log = ctx.log;
        this.sent = Object.create(null);     // component -> the text last written (nothing re-sent unchanged)
        this.picShown = null;                // the layout whose picture NOW_GFX has
        this.note = null;                    // { text, until }: the other app was turned off
        this.timer = null;
        const mc = (ctx.spec.config && ctx.spec.config.menu) || {};
        this.hideModeRows = mc.hideModeRows !== false;
        this.modeRowsOn = null;
        this.hideRowUnlessG20 = mc.hideRowUnlessG20 !== false;
        this.rowRowOn = null;
    }

    guard(what, fn) {
        try { return fn(); } catch (e) { this.log.error('menu ' + what + ': ' + (e && e.stack || e)); return undefined; }
    }
    /** The component is in this build's RHMI (without a warning per call, as ui.comp gives). */
    has(name) {
        const r = this.ui.rhmi;
        return !!(r && typeof r.getByName === 'function' && r.getByName(name));
    }

    start() {
        const ctx = this.ctx, ui = this.ui;
        ui.onClick('BTN_GALLERY', () => this.guard('gallery', () => ui.open('GALLERY')));
        // BTN_SETTINGS (the second screen, app.json SETTINGS: every other setting) is the kit's own: mgu.js opens it
        ui.onClick('NOW', () => this.guard('now', () => {
            const scr = this.hud.screen;
            // stepping aside for the other app: a press takes the screen back; else the gallery
            if (scr && scr.yielded) { scr.claim(); this.soon(); return null; }
            return ui.open('GALLERY');
        }));
        // registered after hud.js's own listener (HudApp's constructor), so the engine has already rebuilt
        ctx.settings.onChange((key) => this.guard('setting ' + key, () => {
            if (LOOK_KEYS.indexOf(key) >= 0 || key === 'byMode') this.takeScreen();
            if (key === 'byMode') this.modeRows(false);
            if (key === 'g20') this.rowRow(false);
            this.soon();
        }));
        this.hud.onStatus(() => this.soon());
        ui.onVisible((name, on) => this.guard('visible', () => {
            // the bottom-row setting's row lives in the Settings list, so it is written again when THAT opens
            if (name === 'SETTINGS' && on) { this.rowRowOn = null; this.rowRow(false); return; }
            if (name !== 'MAIN' || !on) return;
            // the HMI builds the screen afresh: everything again (the kit drops its "same image" memory itself)
            this.sent = Object.create(null); this.picShown = null; this.modeRowsOn = null; this.rowRowOn = null;
            this.soon(0);
        }));
        this.refresh();
    }

    /** A theme was picked: when the cluster now draws one, take the shared screen (the other app steps aside). */
    takeScreen() {
        const hud = this.hud, scr = hud.screen;
        if (!scr || hud._layoutName() === 'off') return;
        const other = scr.otherOn();
        scr.claim();
        if (other) {
            this.note = { text: scr.otherName + ' turned off: the cluster theme has the screen', until: Date.now() + NOTE_MS };
            this.log.info('menu: a theme was picked while ' + scr.otherName + ' was on: it steps aside');
        }
    }

    soon(ms) {
        if (this.timer) return;
        this.timer = setTimeout(() => { this.timer = null; this.refresh(); }, ms === undefined ? 250 : ms);
    }

    refresh() {
        this.guard('refresh', () => {
            this.modeRows(false);
            this.rowRow(false);
            const hud = this.hud, settings = this.ctx.settings, name = shownName(hud);
            const yielded = !!(hud.screen && hud.screen.yielded);
            this.cells('NOW', {
                Text1stRow: layoutName(settings, name),
                Text2ndRow: yielded ? 'Off: ' + hud.screen.otherName + ' has the screen. Press to take it back' : this.nowLine(name),
            });
            const lines = this.statusLines();
            this.text('STATUS', lines[0]);
            this.text('STATUS2', lines[1]);
            this.text('STATUS_LOG', 'Engine: ' + (hud.lastStatus || 'starting'));
            this.picture(name);
        });
    }

    /** NOW's second row: the tag line and where the choice came from. */
    nowLine(name) {
        const hud = this.hud, tag = name === 'off' ? 'stock cluster' : (this.cfg.tags || {})[name] || '';
        let why;
        if (hud.setting('byMode') !== true) why = 'same in every drive mode';
        else if (MODE_KEY[hud.driveMode]) why = 'picked by ' + MODE_NAME[hud.driveMode];
        else why = 'Theme, until the car sends its drive mode';
        return (tag ? tag + ', ' : '') + why;
    }

    /** [headline, details] for STATUS and STATUS2, short enough for one row each. */
    statusLines() {
        const hud = this.hud, scr = hud.screen;
        const ready = !!(hud.client && hud.client.ready);
        const demo = !!(hud.car && hud.car.data && hud.car.data().demo);
        let head;
        if (!ready) head = hud.statusText();
        // 0.7.13: the KOMBI guard turned the theme off (hud.js _kombiWatch)
        else if (hud.kombiTrip) head = 'Off: the cluster reset twice with ' + layoutName(this.ctx.settings, hud.kombiTrip.layout) + '. Pick a theme to try again';
        else if (hud.problem) head = 'Problem: ' + hud.problem;
        else if (scr && scr.yielded) head = 'Off: ' + scr.otherName + ' has the screen';
        else if (!hud.activeName || hud.activeName === 'off') head = "Off: BMW's own cluster shows";
        else head = 'On: ' + layoutName(this.ctx.settings, hud.activeName) + (demo ? ', demo data' : '');
        const parts = [];
        if (this.note && Date.now() < this.note.until) parts.push(this.note.text);
        else this.note = null;
        if (hud.setting('byMode') !== true) parts.push('Same theme in every drive mode');
        else if (hud.driveRaw) parts.push('Drive mode not recognised (the car sends ' + hud.driveRaw + '): Theme shows');
        else if (MODE_KEY[hud.driveMode]) parts.push('Drive mode: ' + MODE_NAME[hud.driveMode]);
        else parts.push('Drive mode not seen yet: Theme shows');
        const drawn = ready && typeof hud._drawnNote === 'function' ? hud._drawnNote().replace(/^, /, '') : '';
        if (drawn) parts.push(drawn);
        if (ready && hud.ownRow && typeof hud._own === 'function') {
            parts.push('Row: ' + ['range', 'clock', 'temp'].map((i) => i + ' ' + (hud._own(i) ? 'ours' : "BMW's")).join(', '));
        }
        return [head, parts.join('. ')];
    }

    /** In Comfort / In Sport / In Eco Pro only while the theme changes with the drive mode (config.menu.hideModeRows). */
    modeRows(force) {
        const on = !this.hideModeRows || this.hud.setting('byMode') === true;
        if (!force && on === this.modeRowsOn) return;
        this.modeRowsOn = on;
        MODE_ROWS.forEach((n) => { if (this.has(n)) this.ui.visible(n, on); });
    }

    /** "Bottom row while G20 shows" only while the G20 toggle is on (config.menu.hideRowUnlessG20): with it off our own
     *  background covers BMW's row, so the row is always ours and there is nothing to pick (hud.js _own). If the HMI
     *  ignores Visible on a list row (unverified on the car, docs/UI-NATIVE-REPORT.md), the row simply stays visible
     *  and is inert - nothing breaks either way. */
    rowRow(force) {
        const on = !this.hideRowUnlessG20 || this.hud.setting('g20') === true;
        if (!force && on === this.rowRowOn) return;
        this.rowRowOn = on;
        if (this.has(ROW_ROW)) this.ui.visible(ROW_ROW, on);
    }

    text(name, s) {
        s = String(s || '');
        if (this.sent[name] === s || !this.has(name)) return;
        this.sent[name] = s;
        this.ui.text(name, s);
    }
    cells(name, obj) {
        const key = JSON.stringify(obj);
        if (this.sent[name] === key || !this.has(name)) return;
        this.sent[name] = key;
        this.ui.cells(name, 0, obj);
    }

    /** NOW_GFX: the theme's picture (previews.js 'big'), or its name on black when there is none (BMW's own). */
    picture(name) {
        if (this.picShown === name || !this.has('NOW_GFX')) return;
        this.picShown = name;
        const p = name !== 'off' ? previews.pixels(name, 'big') : null;
        let cv;
        if (p) cv = new Canvas(p.w, p.h).drawImage(p.px, p.w, p.h, 0, 0, p.w, p.h);
        else {
            cv = new Canvas(888, 333).clear(PIC_BG);
            cv.text(layoutName(this.ctx.settings, name), 444, 178, 30, '#8a96a8', { align: 'center', literal: true });
        }
        // a canvas.js Canvas, not a Recorder: the kit hands it to the HMI as a PNG (mgu.js Ui._image), as on a
        // canvas screen without the renderer; failures are logged there, never thrown
        this.ui.image('NOW_GFX', cv);
    }
}

Menu.LOOK_KEYS = LOOK_KEYS;
Menu.MODE_KEY = MODE_KEY;
Menu.MODE_NAME = MODE_NAME;
Menu.layoutName = layoutName;
Menu.lookKey = lookKey;
Menu.shownName = shownName;
Menu.themeOf = HudApp.themeOf;      // a see-through layout file -> the theme the gallery's cards show
module.exports = Menu;
