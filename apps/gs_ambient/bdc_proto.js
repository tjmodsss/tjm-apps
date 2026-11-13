'use strict';
/**
 * bdc_proto.js - the body controller's temporary RGB actuator, as confirmed on BDC_G05:
 * read the LIN modules (22 DA5F / 22 E3D1, 10 bytes each), write one module
 * (2E DA5E / 2E E3D1) for up to 254 s. Nothing here sends.
 */
const BDC = 0x40;
const SGBD_G05 = '0F2680';
const HOLD_S = 254;
const RENEW_MS = 120000;
const BUSES = [
    { name: 'lin1', read: [0xDA, 0x5F], write: [0xDA, 0x5E] },
    { name: 'lin2', read: [0xE3, 0xD1], write: [0xE3, 0xD1] },
];
// BDC_G05 location table (the same names Iterio uses). The lower zone on this car is the
// footwells, the door pockets and the centre trays. Door lines, the dash, the roof and the rest
// are the upper zone. A location the body controller does not list cannot be written.
const LOWER = {
    0x01: 1, 0x02: 1, 0x03: 1, 0x04: 1, 0x23: 1, 0x24: 1,
    0x08: 1, 0x0B: 1, 0x0F: 1, 0x12: 1, 0x25: 1, 0x26: 1, 0x4D: 1, 0x4E: 1,
    0x52: 1, 0x54: 1, 0x56: 1, 0x58: 1,
    0x1D: 1, 0x1E: 1,
};
const LOC = {
    0x01: 'Footwell driver front', 0x02: 'Footwell driver rear', 0x03: 'Footwell passenger front',
    0x04: 'Footwell passenger rear', 0x05: 'Driver door front line', 0x08: 'Driver door front pocket',
    0x0B: 'Driver door rear pocket', 0x0C: 'Passenger door front line', 0x0F: 'Passenger door front pocket',
    0x12: 'Passenger door rear pocket', 0x13: 'Dash line driver', 0x15: 'Dash line centre',
    0x17: 'Dash line passenger', 0x1D: 'Centre stack tray', 0x1E: 'Console tray',
    0x23: 'Footwell driver 3rd row', 0x24: 'Footwell passenger 3rd row',
    0x35: 'Roof front left front', 0x37: 'Roof front right front', 0x3D: 'Light sword left', 0x3E: 'Light sword right',
};

const cap = (n) => Math.max(0, Math.min(254, Math.round(Number(n) || 0)));
const hex2 = (n) => (n & 255).toString(16).toUpperCase().padStart(2, '0');

function zoneOf(loc) {
    return LOWER[loc] ? 'lower' : 'upper';
}

function nameOf(loc) {
    return LOC[loc] || ('Licht 0x' + hex2(loc));
}

/** 62 F1 50 -> the 6-digit SGBD index, or null. */
function sgbdOf(uds) {
    if (!uds || uds[0] !== 0x62 || uds[1] !== 0xF1 || uds[2] !== 0x50 || uds.length < 6) return null;
    return hex2(uds[3]) + hex2(uds[4]) + hex2(uds[5]);
}

/** One status reply -> the modules that are fitted. NAD is the record's place, starting at 1. */
function parseModules(uds, bus) {
    const out = [];
    for (let i = 3, nad = 1; i + 10 <= (uds ? uds.length : 0); i += 10, nad++) {
        if (uds[i] === 0xFF) continue;
        out.push({ bus: bus, nad: nad, loc: uds[i], zone: zoneOf(uds[i]), name: nameOf(uds[i]) });
    }
    return out;
}

function busOf(name) {
    for (let i = 0; i < BUSES.length; i++) if (BUSES[i].name === name) return BUSES[i];
    return null;
}

/** The write for one module. bright is 0..100. Colour bytes never use 0xFF (that means "no change"). */
function frameWrite(mod, rgb, bright, secs) {
    const bus = busOf(mod.bus);
    const b = Math.max(0, Math.min(100, Math.round(bright)));
    const hold = secs == null || !isFinite(secs) ? HOLD_S : Math.max(0, Math.min(HOLD_S, Math.round(secs)));
    return bus.write.concat([mod.nad, 1, b, cap(rgb[0]), cap(rgb[1]), cap(rgb[2]), hold]);
}

/** Hand the module back to the car's own colour at once. */
function frameRelease(mod) {
    return busOf(mod.bus).write.concat([mod.nad, 0, 0, 0, 0, 0, 0]);
}

/** Keep the module in our hands, but dark, for the longest hold the controller accepts. */
function frameOff(mod) {
    return busOf(mod.bus).write.concat([mod.nad, 1, 0, 0, 0, 0, HOLD_S]);
}

/** Which bytes each fitted module should get for this frame. brightness is 0..1. */
function plan(mods, frame, secs) {
    const bright = Math.round(Math.max(0, Math.min(1, frame.brightness)) * 100);
    return mods.map((m) => ({ mod: m, bytes: frameWrite(m, frame[m.zone] || frame.upper, bright, secs) }));
}

module.exports = {
    BDC: BDC, SGBD_G05: SGBD_G05, HOLD_S: HOLD_S, RENEW_MS: RENEW_MS, BUSES: BUSES,
    zoneOf: zoneOf, nameOf: nameOf, sgbdOf: sgbdOf, parseModules: parseModules, frameWrite: frameWrite, frameRelease: frameRelease, frameOff: frameOff, plan: plan,
};
