'use strict';
/**
 * fx.js - the effects (fx_*.js) and their settings. An effect's settings are stored per effect in the
 * state (params[id]); paramsOf fills in the defaults.
 */
const C = require('./color');

const EFFECTS = [require('./fx_cycle'), require('./fx_pairs'), require('./fx_fade'), require('./fx_breathe')];
const byId = {};
EFFECTS.forEach((e) => { byId[e.id] = e; });

/** The effect's settings: the stored ones over the defaults. */
function paramsOf(e, stored) {
    const out = {};
    e.params.forEach((p) => {
        let v = stored && stored[p.key] !== undefined ? stored[p.key] : p.default;
        if (p.type === 'range' && typeof v === 'number') v = Number(C.clamp(v, p.min, p.max).toFixed(decimals(p.step)));
        out[p.key] = v;
    });
    return out;
}

/** The state's colours and favourites as RGB, for the effects. */
function baseOf(st) {
    return {
        upper: C.toRgb(st.upper), lower: C.toRgb(st.lower), brightness: st.brightness,
        favs: st.favs.map((f) => ({
            upper: C.toRgb(f.upper), lower: C.toRgb(f.lower),
            upperC: { h: f.upper.h, s: f.upper.s }, lowerC: { h: f.lower.h, s: f.lower.s },
        })),
    };
}

/** null when effect e can run now, else why not (shown on its tile). */
function availability(e, inputs, base) {
    if (e.needs.some((k) => inputs[k] === null || inputs[k] === undefined)) return 'Daten nicht verfügbar';
    return e.available ? e.available(base) : null;
}

/** Whether the running effect goes on when the user changes a colour (it is built on the colours). */
function keepsRunning(st) {
    const e = st.effect && byId[st.effect];
    return !!e && e.usesBase(paramsOf(e, st.params[e.id]));
}

const decimals = (step) => (String(step).split('.')[1] || '').length;

/** Setting p moved dir steps on from cur. wrap: past an end starts over (a tap); else it stops there (the knob). */
function stepParam(p, cur, dir, favCount, wrap) {
    if (p.type === 'range') {
        let v = cur + dir * p.step;
        if (wrap && v > p.max + 1e-9) v = p.min;
        if (wrap && v < p.min - 1e-9) v = p.max;
        return Number(C.clamp(v, p.min, p.max).toFixed(decimals(p.step)));
    }
    const values = p.type === 'fav' ? [-1].concat(Array.from({ length: favCount }, (_, i) => i)) : p.options.map((o) => o[0]);
    const i = Math.max(0, values.indexOf(cur));
    const j = wrap ? ((i + dir) % values.length + values.length) % values.length : C.clamp(i + dir, 0, values.length - 1);
    return values[j];
}

/** A setting's value as shown on its button. */
function formatParam(p, v) {
    if (p.type === 'fav') return v < 0 ? 'Standard' : 'Favorit ' + (v + 1);
    if (p.type === 'choice') { const o = p.options.find((x) => x[0] === v); return o ? o[1] : String(v); }
    return v.toFixed(decimals(p.step)).replace('.', ',') + (p.unit ? ' ' + p.unit : '');
}

/**
 * The loop that turns the state into the frame the lights get, hz times a second: the running effect's
 * frame (time from its start; mem cleared at every start), else the fixed colours, also while the
 * effect has no data. sink(frame) gets every frame; the light sender drops unchanged ones.
 */
function createLoop(o) {
    const clock = o.clock || { now: Date.now, setInterval, clearInterval };
    const hz = o.hz || 20;
    let timer = null, id = null, t0 = 0, mem = {}, last = null, why = null;
    function tick() {
        const st = o.getState(), base = baseOf(st), inputs = o.readInputs();
        if (st.effect !== id) { id = st.effect; t0 = clock.now(); mem = {}; }
        const e = id ? byId[id] : null;
        let frame = { upper: base.upper, lower: base.lower, brightness: base.brightness };
        why = e ? availability(e, inputs, base) : null;
        if (e && !why) frame = e.run((clock.now() - t0) / 1000, inputs, paramsOf(e, st.params[e.id]), base, mem);
        last = frame;
        o.sink(frame);
        return frame;
    }
    return {
        tick,
        start() { if (timer === null) timer = clock.setInterval(tick, 1000 / hz); return tick(); },
        stop() { if (timer !== null) clock.clearInterval(timer); timer = null; },
        frame: () => last,
        why: () => why,
    };
}

module.exports = { EFFECTS, byId, paramsOf, baseOf, availability, keepsRunning, stepParam, formatParam, createLoop };
