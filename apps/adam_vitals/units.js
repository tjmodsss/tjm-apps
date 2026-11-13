'use strict';
/**
 * units.js - which units the screen shows and the conversions (pure, Node 8, no kit).
 *
 * Values are kept in the car's units everywhere (deg C, bar, kW, Nm) and converted only where drawn.
 * One setting "units": us (default: psi, deg F, hp, lb-ft), metric (bar, deg C, kW, Nm) or car (the car's own
 * display units, field by field). An explicit us / metric always beats what the car says.
 */
const isNum = (x) => typeof x === 'number' && isFinite(x);
const lin = (k, o) => (x) => (isNum(x) ? x * k + (o || 0) : null);

const PSI_PER_BAR = 14.5038, HP_PER_KW = 1.34102, LBFT_PER_NM = 0.737562;
const US = { temp: 'F', press: 'psi', power: 'hp', torque: 'lb-ft' };
const METRIC = { temp: 'C', press: 'bar', power: 'kW', torque: 'Nm' };

const cToF = (x) => (isNum(x) ? x * 9 / 5 + 32 : null);
const fToC = (x) => (isNum(x) ? (x - 32) * 5 / 9 : null);
const dCToF = lin(1.8);
const barToPsi = lin(PSI_PER_BAR), psiToBar = lin(1 / PSI_PER_BAR);
const kwToHp = lin(HP_PER_KW), hpToKw = lin(1 / HP_PER_KW);
const nmToLbft = lin(LBFT_PER_NM), lbftToNm = lin(1 / LBFT_PER_NM);

/**
 * The units to show. choice: the "units" setting; car: { temp: 'C'|'F'|null, press: 'BAR'|'KPA'|'PSI'|null }
 * (Vehicle.statusNewCurrentUnitsStatusExt). Anything but metric / car (a garbage saved value too) is US, so a
 * missing or metric car signal never overrides US.
 */
function resolve(choice, car) {
    if (choice === 'metric') return Object.assign({}, METRIC);
    if (choice !== 'car') return Object.assign({}, US);
    const c = car || {};
    const metricPress = c.press === 'BAR' || c.press === 'KPA';
    const saysMetric = c.temp === 'C' || metricPress, saysUs = c.temp === 'F' || c.press === 'PSI';
    const m = saysMetric && !saysUs;
    return { temp: c.temp === 'C' ? 'C' : 'F', press: metricPress ? 'bar' : 'psi', power: m ? 'kW' : 'hp', torque: m ? 'Nm' : 'lb-ft' };
}

/* shown value of a deg C / bar / kW / Nm value in units u (null for no value) */
const T = (c, u) => (u.temp === 'F' ? cToF(c) : isNum(c) ? c : null);
const dT = (c, u) => (u.temp === 'F' ? dCToF(c) : isNum(c) ? c : null);
const P = (bar, u) => (u.press === 'psi' ? barToPsi(bar) : isNum(bar) ? bar : null);
const PW = (kw, u) => (u.power === 'hp' ? kwToHp(kw) : isNum(kw) ? kw : null);
const TQ = (nm, u) => (u.torque === 'lb-ft' ? nmToLbft(nm) : isNum(nm) ? nm : null);
const tU = (u) => (u.temp === 'F' ? '°F' : '°C');

/** Boost bar scale; segBar labels count from min, so min sits on a label. */
function boostScale(u) {
    return u.press === 'psi'
        ? { min: -10, max: 30, step: 2, every: 10, decimals: 1, scaleDecimals: 0, warn: 25 }
        : { min: -1, max: 2, step: 0.125, every: 0.5, decimals: 2, scaleDecimals: 1, warn: 1.7 };
}
/** Oil / coolant / transmission bar scale on Main (shown units). */
function tempScale(kind, u) {
    const f = u.temp === 'F';
    if (kind === 'oil') return f ? { min: 100, max: 300, step: 50 } : { min: 30, max: 150, step: 30 };
    if (kind === 'trans') return f ? { min: 60, max: 260, step: 40 } : { min: 10, max: 130, step: 30 };
    return f ? { min: 100, max: 260, step: 40 } : { min: 40, max: 140, step: 20 };
}
/** The Warm-up gauges' scale (one for all three, shown units): segments of step, a label every `every`. */
function warmScale(u) {
    return u.temp === 'F' ? { min: 40, max: 280, step: 20, every: 60 } : { min: 0, max: 140, step: 10, every: 20 };
}

module.exports = {
    US, METRIC, isNum, resolve, cToF, fToC, dCToF, barToPsi, psiToBar, kwToHp, hpToKw, nmToLbft, lbftToNm,
    T, dT, P, PW, TQ, tU, boostScale, tempScale, warmScale,
};
