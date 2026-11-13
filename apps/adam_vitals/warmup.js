'use strict';
/**
 * warmup.js - Warm-Up's pure parts (apps/warmup 1.7.3) and the warm-up takeover of the Main page.
 * Pure, Node 8, no kit. Temperatures in deg C, times in ms on a steady clock.
 *
 *   limit(oil, warmOil, redline, coldLimit)  safe rev limit: coldLimit at 30 deg C oil, redline once warm
 *   measured(hist, idx, windowMs)            deg C / min over the last ~3 min (or windowMs; least squares) and its span
 *   eta(key, temp, target, d, hist)          { state: none | ready | off | stalled | warming, min, rate, est }
 *   hist rows: [mono, oil, coolant, rpm, speed, boost, trans] every 5 s (COL: the column of each temperature)
 *
 * Takeover (immutable: every call returns a new state):
 *   init(), step(s, { oil, coolant, trans, rpm, warmOil, warmCoolant, warmTrans, settled, now, wall }), dismiss(s),
 *   show(s, { enabled, page }), reason(s, enabled) -> 'shown' | 'dismissed' | 'warm' | 'setting off' | 'no temperature'
 * Cold = below any target before the engine has been warm this drive; a temperature that is null (no reading,
 * or the transmission left out by its setting) neither blocks nor counts. Coolant and transmission also count as
 * warm when settled ({ coolant, trans }: eta says stalled) within SETTLE_C under their mark: a thermostat holds
 * them there (BMW's heat management targets ~95 deg C coolant under high load, the 8HP's cooler thermostat opens
 * ~75 deg C), so the view never waits for good on a mark the car won't reach. Oil must reach its mark (it sets
 * the rev limit). Once warm it stays hidden for the
 * drive (no flicker back when a temperature dips). Hide lasts for the drive. A new drive = engine off
 * (rpm < 300 or no rpm) for NEW_DRIVE_MS, then running (rpm > 400): auto start-stop at a light is not one.
 * The time off is the larger of the steady clock (now) and the wall clock (wall, Date.now): the steady clock
 * stops while the head unit sleeps (KB-ANY-203); a wall clock set back counts as no time off.
 */
const isNum = (x) => typeof x === 'number' && isFinite(x);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// typical warm-up rates (deg C / min) until enough has been measured (oil and coolant: Warm-Up's; trans: ours [U],
// the ATF warms through the coolant heat exchanger, so slower than the coolant)
const TYPICAL = { oil: { drive: 4, idle: 1.5 }, coolant: { drive: 7, idle: 3 }, trans: { drive: 3, idle: 1 } };
const COL = { oil: 1, coolant: 2, trans: 6 };
const NEW_DRIVE_MS = 600000;    // product rule: 10 min off is a new drive (start-stop stops are far shorter)
const OFF_RPM = 300, RUN_RPM = 400;
const SETTLE_C = 15;            // settled this close under its mark (27 F) counts as warm (coolant, transmission)
/*
 * The gauges' marks, deg C (README "Temperature marks" has the sources; pages.js colours by them). ready: the "is warm
 * at" settings; oil's crit: the "Oil temp warning" setting. Warming: WARMING_C under ready.
 */
const WARMING_C = 20;
const HOT = { oil: 129.4, coolant: 121.1, trans: 110 };        // 265 F, 250 F, 230 F: amber from here
const CRIT = { coolant: 126.7, trans: 121.1 };                 // 260 F, 250 F: red from here

function limit(oil, warmOil, redline, coldLimit) {
    if (!isNum(oil) || !isNum(redline)) return null;
    const cold = Math.min(isNum(coldLimit) ? coldLimit : redline, redline);
    if (oil >= warmOil) return redline;
    return Math.round((cold + (redline - cold) * clamp((oil - 30) / (warmOil - 30), 0, 1)) / 100) * 100;
}

function measured(hist, idx, windowMs) {
    const h = hist || [];
    const last = h.length ? h[h.length - 1][0] : 0;
    const win = windowMs || 180000;
    const pts = h.filter((r) => isNum(r[idx]) && last - r[0] < win);
    if (pts.length < 4) return { rate: null, span: 0 };
    const n = pts.length, mx = pts.reduce((a, p) => a + p[0], 0) / n, my = pts.reduce((a, p) => a + p[idx], 0) / n;
    let num = 0, den = 0;
    pts.forEach((p) => { num += (p[0] - mx) * (p[idx] - my); den += (p[0] - mx) * (p[0] - mx); });
    return { rate: den ? num / den * 60000 : null, span: pts[n - 1][0] - pts[0][0] };
}

/** The typical rate is blended into the measured one over the first 2 minutes (est = mostly typical). */
function eta(key, temp, target, d, hist) {
    if (!isNum(temp)) return { state: 'none' };
    if (temp >= target) return { state: 'ready' };
    if (isNum(d.rpm) && d.rpm < OFF_RPM) return { state: 'off' };
    const m = measured(hist, COL[key]);
    const typ = TYPICAL[key][isNum(d.speed) && d.speed > 10 ? 'drive' : 'idle'];
    const w = clamp(m.span / 120000, 0, 1);
    const rate = isNum(m.rate) ? w * m.rate + (1 - w) * typ : typ;
    if (w > 0.8 && rate < 0.15) return { state: 'stalled', rate };
    const min = (target - temp) / Math.max(0.15, rate);
    return { state: 'warming', min, rate, est: w < 0.5 };
}

/* ---------- takeover ---------- */
function init() { return { warmedRun: false, dismissed: false, offSince: null, offWall: null, cold: false, hasTemp: false }; }

function step(s, i) {
    const n = Object.assign({}, s);
    const off = !isNum(i.rpm) || i.rpm < OFF_RPM, running = isNum(i.rpm) && i.rpm > RUN_RPM;
    if (off) {
        n.offSince = s.offSince === null ? i.now : s.offSince;
        n.offWall = s.offSince === null || !isNum(s.offWall) ? (isNum(i.wall) ? i.wall : null) : s.offWall;
    } else if (running) {
        const wallOff = isNum(i.wall) && isNum(s.offWall) ? i.wall - s.offWall : 0;     // negative: the clock was set back
        if (s.offSince !== null && Math.max(i.now - s.offSince, wallOff) >= NEW_DRIVE_MS) { n.dismissed = false; n.warmedRun = false; }
        n.offSince = null; n.offWall = null;
    }
    const st = i.settled || {};
    const pairs = [['oil', i.oil, i.warmOil], ['coolant', i.coolant, i.warmCoolant], ['trans', i.trans, i.warmTrans]].filter((p) => isNum(p[1]) && isNum(p[2]));
    const warm = (p) => p[1] >= p[2] || (p[0] !== 'oil' && st[p[0]] === true && p[1] >= p[2] - SETTLE_C);
    n.hasTemp = pairs.length > 0;
    if (n.hasTemp && pairs.every(warm)) n.warmedRun = true;
    n.cold = !n.warmedRun && pairs.some((p) => !warm(p));
    return n;
}

const dismiss = (s) => Object.assign({}, s, { dismissed: true });
const show = (s, o) => !!(o.enabled && s.cold && !s.dismissed && o.page === 'main');
function reason(s, enabled) {
    if (!enabled) return 'setting off';
    if (!s.hasTemp) return 'no temperature';
    if (s.dismissed && s.cold) return 'dismissed';
    if (!s.cold) return 'warm';
    return 'shown';
}

module.exports = { TYPICAL, COL, NEW_DRIVE_MS, SETTLE_C, WARMING_C, HOT, CRIT, limit, measured, eta, init, step, dismiss, show, reason };
