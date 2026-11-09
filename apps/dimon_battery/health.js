'use strict';
/**
 * 12 V battery health from the IBS / engine-unit readings. Pure functions, no I/O, so
 * they are easy to test. Inputs are already scaled: voltage in V, current in A (negative
 * = discharging, as the IBS reports), SOC and SOH in %, temperature in C.
 */

// Resting terminal voltage -> state of charge %, for a 12 V lead-acid / AGM battery near 20 C.
const REST_TABLE = [
    [12.80, 100], [12.60, 90], [12.40, 75], [12.20, 55],
    [12.00, 40], [11.80, 25], [11.60, 10], [11.00, 0],
];

/** State of charge from resting voltage (null if out of the table's range or no reading). */
function chargeFromVoltage(v) {
    if (v == null || !isFinite(v)) return null;
    if (v >= REST_TABLE[0][0]) return 100;
    if (v <= REST_TABLE[REST_TABLE.length - 1][0]) return 0;
    for (let i = 0; i < REST_TABLE.length - 1; i++) {
        const vh = REST_TABLE[i][0], ph = REST_TABLE[i][1];
        const vl = REST_TABLE[i + 1][0], pl = REST_TABLE[i + 1][1];
        if (v <= vh && v >= vl) {
            const f = (v - vl) / (vh - vl);
            return Math.round(pl + f * (ph - pl));
        }
    }
    return null;
}

/** charging / discharging / resting / unknown, from the IBS current (A). */
function state(current) {
    if (current == null || !isFinite(current)) return 'unknown';
    if (current > 1.0) return 'charging';
    if (current < -1.0) return 'discharging';
    return 'resting';
}

/** good / fair / poor / unknown, from the battery's state of health (%). */
function sohClass(soh) {
    if (soh == null || !isFinite(soh)) return 'unknown';
    if (soh >= 80) return 'good';
    if (soh >= 60) return 'fair';
    return 'poor';
}

/**
 * assess({ voltage, current, soc, soh, temp }) ->
 *   { state, charge, restCharge, sohClass, verdict, warnings }
 * charge prefers the reported SOC; at rest it falls back to the resting-voltage estimate.
 * verdict is good / aging / weak.
 */
function assess(r) {
    r = r || {};
    const st = state(r.current);
    const restCharge = st === 'resting' ? chargeFromVoltage(r.voltage) : null;
    const charge = (r.soc != null && isFinite(r.soc)) ? Math.round(r.soc) : restCharge;
    const soh = sohClass(r.soh);
    const warnings = [];

    if (st === 'resting' && r.voltage != null && r.voltage < 12.2) warnings.push('Low resting voltage - charge the battery');
    if (r.soc != null && isFinite(r.soc) && r.soc < 50 && st !== 'charging') warnings.push('State of charge under 50%');
    if (soh === 'poor') warnings.push('State of health low - replacement likely due');
    if (st === 'charging' && r.voltage != null && r.voltage > 15.2) warnings.push('Charging voltage high');
    if (st === 'discharging' && r.current != null && r.current < -40) warnings.push('High discharge current');

    let verdict;
    if (soh === 'poor' || (restCharge != null && restCharge < 25)) verdict = 'weak';
    else if (soh === 'fair' || (charge != null && charge < 50)) verdict = 'aging';
    else verdict = 'good';

    return { state: st, charge: charge, restCharge: restCharge, sohClass: soh, verdict: verdict, warnings: warnings };
}

module.exports = { assess, chargeFromVoltage, state, sohClass };
