'use strict';
/**
 * logic.js - M Track Cluster's decisions, pure: no I/O, no clock of its own (every time is passed in), Node 8.
 *
 *   driveModeOf(raw)              FES statusFESVehicleDynamicSwitchHMI.actualValueModeDrivingExperience ->
 *                                 'sportplus' | 'sport' | 'comfort' | null (Shift Lights' decoding)
 *   allowed(mode, when)           the "When to show" setting against the car's drive mode
 *   decide(s, now, since)         -> { want, reason, since }: whether the cover may show now. Every condition
 *                                 must hold for showHoldMs on the passed wall clock first; any failing one
 *                                 gives want false at once, with its reason. The Safety settings (BMW popups,
 *                                 drop if no drive mode, speed timeout) come in s; anything unknown is the strict side.
 *   speedStatus(at, now, ms, cfg) 'present' | 'stale' | 'missing': the speed signal as the speed guard sees it
 *   thresholds / step             the slats (Shift Lights' logic: cold-oil limit, hysteresis, limiter flash)
 *   makeLead(R)                   Shift Lights' rpm lead (the bar and the slats a moment ahead of slow rpm updates)
 *   gearGlyph(stage, gear)        what the centre's gear spot shows: P R N, the engaged gear's digit, D, or '-'
 *   readSettings(get, schema)     the saved settings checked against app.json (bad -> default, or the strict side
 *                                 for a Safety setting), plus
 *   layoutOf(v)                   the panels as drawn: whole widgets take both halves, swap, hidden -> default
 */
const C = require('./catalogue');
const { clean } = require('./settings_check');

const SETTINGS_V = 2;       // settings.json shape: 2 = the Safety settings (0.1.1), 1 = 0.1.0
const RANK = { sportplus: 3, sport: 2, comfort: 0 };
const NEED = { sportplus: 3, sport: 2 };
const POPUP_GUARDS = ['auto', 'require', 'ignore'];
/** A Safety setting saved with a value that is not valid takes its strict side, never a weaker default. */
const STRICT = { popupGuard: 'require', modeMissingDrop: true };
const NEW_IN_V2 = ['popupGuard', 'modeMissingDrop', 'speedStaleMs'];
const REASONS = {
    showing: 'Showing',
    hold: 'Showing in a moment',
    off: 'Off',
    kill: 'Off: kill file',
    tripped: 'Stopped after errors: turn the cover off and on',
    demo: 'Demo data: the cover never shows on demo data',
    noart: 'The art file is missing or damaged: reinstall the app',
    renderer: 'Cluster renderer not connected',
    nocc: 'No BMW popup signal, and BMW popups is set to Require',
    ccwait: 'Checking for the BMW popup signal',
    cc: 'BMW popup: the cover gives way',
    busy: 'Another app is using the cluster: turn off Shift Lights cluster/HUD',
    held: 'BMW holds the cluster panel (a popup or the speech dialog)',
    nospeed: 'No fresh speed signal: the cover stays off',
    error: 'Error: the cover gives way for a moment',
    nomode: 'No drive-mode signal, and Drop if missing is on',
    mode: 'Waiting for the drive mode',
};

const num = (v) => typeof v === 'number' && isFinite(v);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function driveModeOf(raw) {
    let v = raw;
    if (typeof v === 'string' && /^\d+$/.test(v.trim())) v = Number(v.trim());
    if (typeof v === 'number') {
        if (v === 2) return 'sportplus';
        if (v === 1 || v === 3) return 'sport';
        if (v >= 4 && v <= 10 && Math.floor(v) === v) return 'comfort';
        return null;
    }
    if (typeof v !== 'string') return null;
    const s = v.trim().toUpperCase();
    if (s.indexOf('SPORT_EXPERT') === 0) return 'sportplus';
    if (s.indexOf('SPORT') === 0) return 'sport';
    if (s.indexOf('COMFORT') === 0 || s.indexOf('ECO') === 0 || s.indexOf('ADAPTIVE') === 0) return 'comfort';
    return null;
}

/** "Sport+ only" needs Sport+, "Sport and above" Sport or Sport+ (Sport individual decodes as Sport), "Always" any. */
function allowed(mode, when) {
    if (when === 'always') return true;
    const need = NEED[when] || NEED.sportplus;            // a garbage value is the strictest
    return Object.prototype.hasOwnProperty.call(RANK, mode) && RANK[mode] >= need;
}

/** BMW popups as the guard reads it: 'auto' | 'require' | 'ignore'; anything else is the strict 'require'. */
const popupGuardOf = (x) => (POPUP_GUARDS.indexOf(x) >= 0 ? x : STRICT.popupGuard);
/** The speed timeout in use (ms): a value within the safety bounds, else the tested default. Never off. */
function staleMsOf(x, cfg) {
    const S = cfg.safety;
    return num(x) && x >= S.speedStaleMinMs && x <= S.speedStaleMaxMs ? x : S.speedStaleMs;
}
/** The speed signal: 'missing' (never a valid one), 'stale' (older than the timeout, or from the future: a clock jump), 'present'. */
function speedStatus(at, now, ms, cfg) {
    if (!num(at)) return 'missing';
    return now - at > staleMsOf(ms, cfg) || now < at ? 'stale' : 'present';
}

/** The first condition that keeps the cover off, or ''. s: see decide. */
function blocker(s, now, cfg) {
    const S = cfg.safety, pg = popupGuardOf(s.popupGuard);
    const cc = s.cc === 'present' || s.cc === 'missing' ? s.cc : 'waiting';    // an unknown state counts as not answered yet
    if (s.coverOn !== true) return 'off';
    if (s.killed) return 'kill';
    if (s.tripped) return 'tripped';
    if (s.demo) return 'demo';
    if (s.art !== true) return 'noart';
    if (s.link !== 'ready') return 'renderer';
    if (s.busy) return 'busy';                                                  // the shared scene is another app's
    if (pg === 'require' && cc !== 'present') return 'nocc';
    if (pg === 'auto' && cc === 'waiting') return 'ccwait';
    if (pg !== 'ignore' && s.ccActive) return 'cc';
    if (pg !== 'ignore' && num(s.ccNewAt) && now - s.ccNewAt >= 0 && now - s.ccNewAt < S.showHoldMs) return 'cc';
    if (s.target === 'waiting' || s.target === 'parked') return s.holder === 'foreign' ? 'busy' : 'held';
    const back = cfg.renderer.heldBackoffMs;                                    // after BMW took it: wait before asking again
    if (num(s.heldUntil) && now < s.heldUntil && s.heldUntil - now <= back) return 'held';
    if (speedStatus(s.speedAt, now, s.staleMs, cfg) !== 'present') return 'nospeed';
    if (num(s.lastErrorAt) && now - s.lastErrorAt >= 0 && now - s.lastErrorAt < S.showHoldMs) return 'error';
    const known = Object.prototype.hasOwnProperty.call(RANK, s.mode);
    if (!known && s.modeMissingDrop !== false) return 'nomode';                 // only an explicit false lets it through
    if (!allowed(s.mode, s.when)) return 'mode';
    return '';
}

/**
 * s = { coverOn, killed, tripped, demo, art (the art loaded), link ('ready' once cluster-render answered),
 * cc ('present' | 'waiting' | 'missing': the Check Control list), ccActive, ccNewAt, target, holder (the panel
 * target's last event), busy (renderer.busyOf: why the shared scene is another app's, or ''), heldUntil (wall ms: BMW
 * took the panel, ask again after it), speedAt (wall ms of the last valid speed), lastErrorAt, mode (null: no drive mode), when,
 * popupGuard, modeMissingDrop, staleMs (the Safety settings) }. since: when every condition last started holding
 * (null: not holding). A clock that jumps backwards restarts the hold (KB-ANY-203).
 */
function decide(s, now, since, cfg) {
    const S = cfg.safety, b = blocker(s || {}, now, cfg);
    if (b) return { want: false, reason: b, since: null };
    const t0 = num(since) && since <= now ? since : now;
    const want = now - t0 >= S.showHoldMs;
    return { want, reason: want ? 'showing' : 'hold', since: t0 };
}

/* ---------- the slats: apps/adam_shiftlights/logic.js thresholds, fillLit, rawState, step ---------- */

function thresholds(cfg, mode, oil) {
    const E = cfg.engine, mt = cfg.modes[mode] || cfg.modes.sportplus;
    const warm = num(oil) ? clamp((oil - E.oilCold) / (E.oilWarm - E.oilCold), 0, 1) : 1;
    const limit = Math.round((E.limitCold + (E.limitWarm - E.limitCold) * warm) / 50) * 50;
    const shift = Math.min(mt.shift, limit - E.shiftBelowLimit);
    return { limit, shift, start: shift - (mt.shift - mt.start) };
}
const validRpm = (rpm) => num(rpm) && rpm >= 0;
const fillLit = (rpm, th, n, reds) => {
    const m = n - (reds > 0 ? reds : 1);
    return Math.ceil(clamp((rpm - th.start) * m / (th.shift - th.start), 0, m));
};
function rawState(rpm, th, n, band, reds) {
    if (!validRpm(rpm)) return { lit: 0, red: false, flashing: false };
    const flashing = rpm >= th.limit - band, red = rpm >= th.shift;
    return { lit: red || flashing ? n : fillLit(rpm, th, n, reds), red, flashing };
}
/**
 * The next slat state with hysteresis (a slat goes off only hysteresisRpm under where it came on). leadAdd: the rpm a
 * lead (makeLead) added; a predicted rpm goes off by its own lead too, so the prediction falling away never flickers.
 */
function step(prev, rpm, th, cfg, leadAdd) {
    const n = cfg.row.perSide, reds = cfg.row.reds;
    if (!validRpm(rpm)) return { lit: 0, red: false, flashing: false };
    const H = cfg.engine.hysteresisRpm + (num(leadAdd) && leadAdd > 0 ? leadAdd : 0), band = cfg.engine.limiterBand;
    const p = prev || { lit: 0, red: false, flashing: false };
    const raw = rawState(rpm, th, n, band, reds);
    const flashing = raw.flashing || (p.flashing && rpm >= th.limit - band - H);
    const red = raw.red || (p.red && rpm >= th.shift - H);
    const lit = red || flashing ? n : Math.max(raw.lit, Math.min(p.lit, fillLit(rpm + H, th, n, reds)));
    return { lit, red, flashing };
}

/**
 * The rpm a moment ahead (apps/adam_shiftlights/logic.js makeLead, plus the maxAddRpm cap): makeLead(cfg.rpmLead) ->
 * lead(rpm, tMs, leadMs) -> { rpm: rpm + add, add } with 0 <= add <= maxAddRpm. add = slope (rpm/ms over the last
 * slopeWindowMs, at most maxSlope) x leadMs (0 to 150). Only a rise leads: a slope under minSlope gives none (noise, a
 * steady rpm, a fall), ramping in to the full slope at 2 x minSlope. Speed ticks re-send the same rpm: an unchanged rpm
 * inside the window keeps the last slope. An invalid rpm or time clears the history (no lead), and so does a time that
 * went back (a new source, or the wall clock set back: KB-ANY-204). Never throws.
 */
function makeLead(R) {
    let h = [], k = 0;      // h: [tMs, rpm] at each change, oldest first; k: the gated slope (rpm/ms)
    const out = (rpm, ms) => { const add = Math.min(k * ms, R.maxAddRpm); return { rpm: rpm + add, add }; };
    return function lead(rpm, tMs, leadMs) {
        const ms = num(leadMs) ? clamp(leadMs, 0, 150) : 0;
        if (!validRpm(rpm) || !num(tMs)) { h = []; k = 0; return { rpm, add: 0 }; }
        const top = h[h.length - 1];
        if (top && tMs < top[0]) h = [];        // time went back (a new source): start again
        else if (top && top[1] === rpm && tMs - top[0] < R.slopeWindowMs) return out(rpm, ms);
        if (!top || top[1] !== rpm || !h.length) h.push([tMs, rpm]);
        h = h.filter((x) => tMs - x[0] <= 2 * R.slopeWindowMs);
        let ref = h[0];
        h.forEach((x) => { if (tMs - x[0] >= R.slopeWindowMs) ref = x; });
        k = 0;
        if (ref && tMs - ref[0] >= R.slopeMinSpanMs) {
            const s = Math.min((rpm - ref[1]) / (tMs - ref[0]), R.maxSlope);
            k = s > R.minSlope ? s * clamp((s - R.minSlope) / R.minSlope, 0, 1) : 0;
        }
        return out(rpm, ms);
    };
}

/**
 * What the centre's gear spot shows (Shift Lights' gearGlyph, with M Track's centre never empty while driving). stage:
 * the selector 'P' / 'R' / 'N' / 'D' (kit/car.js; manual mode stays D, the car's enums have no M or S), gear: the engaged
 * gear (1 up, 0 = N or P not told apart, -1 = R). P R N -> that letter; D (or no stage) with a whole gear 1 to 8 -> its
 * digit; D with no usable gear -> 'D'; no stage and gear -1 -> 'R'; anything else -> '-'. No M prefix, no guess.
 */
function gearGlyph(stage, gear) {
    if (stage === 'P' || stage === 'R' || stage === 'N') return stage;
    const none = stage === undefined || stage === null;
    if (stage !== 'D' && !none) return '-';
    const whole = typeof gear === 'number' && Math.floor(gear) === gear;
    if (whole && gear >= 1 && gear <= 8) return String(gear);
    if (stage === 'D') return 'D';
    return whole && gear === -1 ? 'R' : '-';
}

/* ---------- settings ---------- */

const PANEL_KEYS = ['leftPanel', 'leftLower', 'rightPanel', 'rightLower'];

/**
 * The saved settings checked against app.json (a bad value -> its default, its key in bad; a Safety setting's bad
 * value -> its strict side, STRICT), then a hidden widget (no signal in this app) falls back to the setting's default too.
 */
function readSettings(get, schema) {
    const raw = {};
    (schema || []).forEach((s) => { let v; try { v = get(s.key); } catch (e) { v = undefined; } if (v !== undefined) raw[s.key] = v; });
    const r = clean(schema, raw), v = r.values, bad = r.bad.slice();
    Object.keys(STRICT).forEach((k) => { if (bad.indexOf(k) >= 0) v[k] = STRICT[k]; });
    PANEL_KEYS.forEach((k) => {
        const w = C.get(v[k]);
        if (w && w.inApp) return;
        const s = (schema || []).filter((x) => x.key === k)[0];
        if (s && v[k] !== s.default) { if (bad.indexOf(k) < 0) bad.push(k); v[k] = s.default; }
    });
    return { values: v, bad };
}

/** One side's widgets: { full } for a whole widget, else { upper, lower } (a whole in a lower half is ignored). */
function sideOf(upper, lower) {
    const u = C.get(upper), l = C.get(lower);
    if (u && u.kind === 'whole') return { full: u.id };
    return { upper: u ? u.id : 'none', lower: l && l.kind === 'half' && l.inApp ? l.id : 'none' };
}
/** v: readSettings values. Swap moves the panel contents only (the corner gauges stay). */
function layoutOf(v) {
    const L = sideOf(v.leftPanel, v.leftLower), R = sideOf(v.rightPanel, v.rightLower);
    return v.swapSides === true ? { left: R, right: L } : { left: L, right: R };
}

/**
 * The writes that bring an older settings.json to this shape. 0.1.0 (v1) had no Safety settings: each one not saved
 * gets its app.json default written (BMW popups = Use when the car sends it), then _settingsV. A saved value is
 * never overwritten here: a bad one is read as its strict side (readSettings). Never throws.
 */
function migrateSettings(get, schema) {
    const g = (k) => { try { return get(k); } catch (e) { return undefined; } };
    if (g('_settingsV') === SETTINGS_V) return [];
    const writes = [];
    NEW_IN_V2.forEach((k) => {
        const s = (schema || []).filter((x) => x && x.key === k)[0];
        if (s && g(k) === undefined) writes.push([k, s.default]);
    });
    writes.push(['_settingsV', SETTINGS_V]);
    return writes;
}

/**
 * The 0-60 mph (or 0-100 km/h) timer from speed samples (Drag Timer's rule): armed at a standstill (under 0.5 km/h),
 * started where the speed crosses 0.5 km/h, stopped where it crosses target; both crossings interpolated between
 * samples. Aborted by stopping again or after 30 s. t = the previous state (null at first); returns the next one.
 */
function timerStep(t, kmh, now, target) {
    const p = t || { phase: 'idle', t0: null, lastKmh: null, lastT: null, last: null, best: null };
    if (!num(kmh) || !num(now)) return p;
    const n = Object.assign({}, p, { lastKmh: kmh, lastT: now });
    const cross = (lv) => (num(p.lastKmh) && num(p.lastT) && kmh !== p.lastKmh ? p.lastT + (lv - p.lastKmh) / (kmh - p.lastKmh) * (now - p.lastT) : now);
    if (kmh < 0.5) return Object.assign(n, { phase: 'ready', t0: null });
    if (p.phase === 'ready') return Object.assign(n, { phase: 'run', t0: cross(0.5) });
    if (p.phase === 'run') {
        if (kmh >= target) {
            const s = Math.round((cross(target) - p.t0) / 100) / 10;
            return Object.assign(n, { phase: 'idle', t0: null, last: s, best: num(p.best) ? Math.min(p.best, s) : s });
        }
        if (now - p.t0 > 30000) return Object.assign(n, { phase: 'idle', t0: null });
    }
    return n;
}

/** Brightness 0..1: the setting (%) times night dim. */
const levelOf = (cfg, v) => Math.round((num(v.bright) ? v.bright : 100) / 100 * (v.nightDim === true ? cfg.nightDim : 1) * 1000) / 1000;

module.exports = {
    SETTINGS_V, RANK, REASONS, PANEL_KEYS, POPUP_GUARDS, STRICT, driveModeOf, allowed, decide, blocker, popupGuardOf,
    staleMsOf, speedStatus, thresholds, rawState, step, makeLead, gearGlyph, readSettings, layoutOf, sideOf, migrateSettings, levelOf, timerStep,
};
