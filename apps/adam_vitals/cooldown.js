'use strict';
/**
 * cooldown.js - turbo cool-down after hard driving (Warm-Up 1.7.3's model, extended). Pure, Node 8, no kit.
 *
 * Hard use (rpm over HARD_RPM, power over HARD_KW or boost over HARD_BOOST_BAR) for more than HARD_START_S
 * asks for COOL_MIN + 3 s per hard second of cool-down, at most COOL_MAX. It counts down only while the engine
 * runs gently (under GENTLE_RPM and GENTLE_KW: driving gently or idling). Short bursts fade away. "Cooled"
 * stays DONE_HOLD_MS, then all clear. An engine off for OFF_RESET_S has cooled by itself. This is a load
 * model, not a turbo temperature: README.md has the thresholds and their sources.
 *
 *   init(), step(s, { rpm, kw, boost, speed }, dtSec, monoMs) -> new state (s is never changed)
 *   advice(s, { rpm, speed, kw }) -> { state: none | done | off | paused | idle | gentle | drive, left, need, frac, moving }
 *   message(a) -> the status line for an advice
 */
const isNum = (x) => typeof x === 'number' && isFinite(x);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

const C = {
    HARD_RPM: 3800, HARD_KW: 90, HARD_BOOST_BAR: 0.8, GENTLE_RPM: 2800, GENTLE_KW: 40, HARD_START_S: 8,
    COOL_MIN: 30, COOL_MAX: 180, PER_HARD_S: 3, FADE: 0.2, DONE_HOLD_MS: 20000, STOPPED_KMH: 5, OFF_RPM: 300,
    OFF_RESET_S: 900, MAX_DT_S: 0.25,
};

const init = () => ({ hardS: 0, needS: 0, cool: 0, doneAt: null, offS: 0 });
const gentleOf = (rpm, kw) => rpm < C.GENTLE_RPM && kw < C.GENTLE_KW;

function step(s, i, dtSec, monoMs) {
    const n = Object.assign({}, s);
    const dt = clamp(isNum(dtSec) ? dtSec : 0, 0, C.MAX_DT_S);     // a clock step back counts as no time
    // no rpm signal: nothing to count, but "Cooled" still clears after its hold (KB-ANY-203)
    if (!isNum(i.rpm)) return n.doneAt !== null && monoMs - n.doneAt > C.DONE_HOLD_MS ? init() : n;
    const kw = isNum(i.kw) ? i.kw : 0;
    if (i.rpm < C.OFF_RPM) {
        // engine off: no oil flow, so it does not count as cooling; off long enough, it has cooled anyway
        n.offS = s.offS + dt;
        if (n.offS >= C.OFF_RESET_S) return init();
    } else {
        n.offS = 0;
        const hard = i.rpm > C.HARD_RPM || kw > C.HARD_KW || (isNum(i.boost) && i.boost > C.HARD_BOOST_BAR);
        if (hard) {
            n.hardS = s.hardS + dt; n.cool = 0; n.doneAt = null;
            if (n.hardS > C.HARD_START_S) n.needS = clamp(C.COOL_MIN + n.hardS * C.PER_HARD_S, C.COOL_MIN, C.COOL_MAX);
        } else if (s.needS > 0 && gentleOf(i.rpm, kw)) {
            n.cool = s.cool + dt;
            if (n.cool >= s.needS && n.doneAt === null) n.doneAt = monoMs;
        } else if (!s.needS) {
            n.hardS = Math.max(0, s.hardS - dt * C.FADE);
        }
    }
    if (n.doneAt !== null && monoMs - n.doneAt > C.DONE_HOLD_MS) return init();
    return n;
}

function advice(s, i) {
    const need = s.needS, left = Math.max(0, need - s.cool), frac = need ? clamp(s.cool / need, 0, 1) : 1;
    const moving = isNum(i.speed) && i.speed >= C.STOPPED_KMH;
    const out = (state) => ({ state, left, need, frac, moving });
    if (!need) return out('none');
    if (s.doneAt !== null) return out('done');
    if (!isNum(i.rpm) || i.rpm < C.OFF_RPM) return out('off');
    if (!gentleOf(i.rpm, isNum(i.kw) ? i.kw : 0)) return out('paused');
    if (!isNum(i.speed)) return out('gentle');
    return out(moving ? 'drive' : 'idle');
}

function message(a) {
    const n = Math.ceil(a.left);
    switch (a.state) {
    case 'none': return a.moving ? 'NO COOL-DOWN NEEDED' : 'OK TO SHUT OFF';
    case 'done': return 'COOLED - OK TO SHUT OFF';
    case 'off': return 'ENGINE OFF - COOL-DOWN NOT FINISHED';
    case 'paused': return 'PAUSED - STAY UNDER ' + C.GENTLE_RPM + ' RPM, LIGHT THROTTLE';
    case 'idle': return 'IDLE ~' + n + ' s BEFORE SWITCHING OFF';
    case 'drive': return 'KEEP DRIVING GENTLY ~' + n + ' s';
    default: return 'KEEP IT GENTLE ~' + n + ' s';
    }
}

module.exports = { C, init, step, advice, message };
