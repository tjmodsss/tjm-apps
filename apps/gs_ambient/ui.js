'use strict';
/**
 * ui.js - the screen: header tabs (one per page module) with the status badge, the page, and the actions
 * the pages call. A page is { title, draw(cv, t, m, act) }.
 */
const G = require('./kit/gauges');
const fx = require('./fx');

const W = 1600, H = 520;
const PAGES = [require('./ui_color'), require('./ui_effects'), require('./ui_favs')];
const BADGE = { simuliert: ['SIMULIERT', 'cold'], aktiv: ['AKTIV', 'ok'], aus: ['AUS', 'warn'], fehler: ['FEHLER', 'crit'], gesperrt: ['GESPERRT', 'warn'] };

function badge(st) {
    const b = BADGE[st.state] || BADGE.simuliert;
    const withReason = st.state === 'fehler' || st.state === 'aus';
    return { text: withReason && st.reason ? b[0] + ' · ' + st.reason : b[0], color: b[1] };
}

/** What the pages draw from. deps = { state, loop, sender(), inputs() } */
function model(deps, view) {
    const st = deps.state.get(), inputs = deps.inputs(), base = fx.baseOf(st);
    return {
        st, view, base, inputs,
        frame: deps.loop.frame() || { upper: base.upper, lower: base.lower, brightness: base.brightness },
        why: deps.loop.why(),
        status: deps.sender().status(),
        avail: fx.EFFECTS.map((e) => ({ e, why: fx.availability(e, inputs, base) })),
        params: (e) => fx.paramsOf(e, st.params[e.id]),
    };
}

/** The changes the pages make. Changing a colour ends an effect that is not built on the colours. */
function makeActions(state, view) {
    const zoneColor = () => { const st = state.get(); return st[st.zone]; };
    const colorChanged = () => { const st = state.get(); if (st.effect && !fx.keepsRunning(st)) state.setEffect(null); };
    return {
        get: () => state.get(),
        wheel(col) { if (!col) return; state.setColor(state.get().zone, col); colorChanged(); },
        turnHue(d) { const c = zoneColor(); state.setColor(state.get().zone, { h: c.h + d * 5, s: c.s }); colorChanged(); },
        setSat(v) { const c = zoneColor(); state.setColor(state.get().zone, { h: c.h, s: v }); colorChanged(); },
        setBrightness(v) { state.setBrightness(v); },
        zone(z) { state.setZone(z); },
        toggleZone() { state.setZone(state.get().zone === 'upper' ? 'lower' : 'upper'); },
        swap() { state.swap(); colorChanged(); },
        same() { state.same(); colorChanged(); },
        startEffect(id) { state.setEffect(id); },
        stopEffect() { state.setEffect(null); },
        stepParam(e, p, dir, wrap) {
            const st = state.get();
            state.setParam(e.id, p.key, fx.stepParam(p, fx.paramsOf(e, st.params[e.id])[p.key], dir, st.favs.length, wrap));
        },
        applyFav(i) { state.applyFav(i); state.setEffect(null); },
        addFav() { return state.addFav(); },
        setGroup(i) { state.setGroup(i); view.editFavs = false; },
        beginNew() {
            if (state.get().groups.length >= state.MAX_GROUPS) return;
            view.naming = 'new'; view.draft = ''; view.shift = true;
        },
        beginRename() {
            view.naming = 'rename'; view.draft = state.get().groups[state.get().group].name; view.shift = false;
        },
        typeChar(ch) {
            if (view.draft.length >= 18) return;
            const c = ch === 'ß' ? 'ß' : (view.shift ? String(ch).toUpperCase() : String(ch).toLowerCase());
            view.draft += c;
            if (view.shift) view.shift = false;
        },
        backspace() { view.draft = view.draft.slice(0, -1); if (!view.draft) view.shift = true; },
        toggleShift() { view.shift = !view.shift; },
        cancelName() { view.naming = null; },
        commitName() {
            const name = String(view.draft || '').trim();
            if (!name) return;
            if (view.naming === 'new') state.addGroup(name);
            else state.renameGroup(name);
            view.naming = null;
        },
        deleteGroup(i) { state.deleteGroup(i); },
        removeFav(i) { state.removeFav(i); },
        toggleEdit() { view.editFavs = !view.editFavs; },
    };
}

/** One frame of page view.page on cv. */
function drawPage(cv, t, deps, view, act) {
    const m = model(deps, view);
    PAGES[view.page].draw(cv, t, m, act);
    if (!cv.own) cv.text('Bedienung per Touch und Controller nur im Vollbild mit GPU-Renderer', W / 2, 510, 18, t.dim, { align: 'center' });
    G.frame(cv, t, PAGES.map((p) => p.title), view.page, [badge(m.status), m.inputs.demo && { text: 'DEMO' }]);
    return m;
}

function start(ctx, deps) {
    const { ui, log } = ctx;
    const view = { page: 0, editFavs: false, naming: null, draft: '', shift: true };
    const act = makeActions(deps.state, view);
    const render = () => {
        const t = ctx.theme(), cv = ctx.canvas(W, H).clear(t.bg);
        drawPage(cv, t, deps, view, act);
        return ui.image('MAIN_GFX', cv);
    };
    const open = (i) => { view.page = i; view.editFavs = false; view.naming = null; return render(); };
    ctx.onTab((i) => open(i));
    ui.onClick('BTN_PAGE', () => open((view.page + 1) % PAGES.length));
    ctx.loop('MAIN', 10, render);
    render().catch((e) => log.warn('first render: ' + e));
}

module.exports = { start, drawPage, makeActions, model, badge, PAGES, W, H };
