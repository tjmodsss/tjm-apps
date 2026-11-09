'use strict';
/**
 * items.js - Car Care's service items and the arithmetic, with no car in it (so it can be tested on a PC).
 *
 * Each item is due by distance, by time, or by whichever comes first. Its last service is kept as the
 * odometer (km) and the date it was done; nothing here touches BMW's own service reminders (CBS), so a
 * dealer's free service still comes due on BMW's own schedule.
 *
 *   status(item, rec, odoKm, now) -> { known, leftKm, leftDays, frac (0 new .. 1 due, >1 overdue), due, soon }
 *
 * Node 8: no ?., ??, object spread or optional catch binding.
 */

const MI = 1.609344;
const DAY = 86400000;

// key, name, the setting holding its interval (miles or months), the default, and how it is due
const ITEMS = [
    { key: 'oil', name: 'Engine oil', setting: 'oilMi', unit: 'mi', def: 3000, months: 12 },
    { key: 'plugs', name: 'Spark plugs', setting: 'plugsMi', unit: 'mi', def: 30000 },
    { key: 'coils', name: 'Ignition coils', setting: 'coilsMi', unit: 'mi', def: 60000 },
    { key: 'diff', name: 'Diff fluid (front and rear)', setting: 'diffMi', unit: 'mi', def: 50000 },
    { key: 'xfer', name: 'Transfer case fluid', setting: 'xferMi', unit: 'mi', def: 50000 },
    { key: 'trans', name: 'Transmission fluid', setting: 'transMi', unit: 'mi', def: 60000 },
    { key: 'brake', name: 'Brake fluid', setting: 'brakeMo', unit: 'mo', def: 24 },
    { key: 'air', name: 'Engine air filter', setting: 'airMi', unit: 'mi', def: 30000 },
    { key: 'cabin', name: 'Cabin filter', setting: 'cabinMo', unit: 'mo', def: 12 },
];
const SOON = 0.9;            // "due soon" from 90 % of the interval on
/** 12345 -> "12,345" (Node 8 on the car may have no locale data for toLocaleString). */
const commas = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

function intervalOf(item, settings) {
    const v = Number(settings && settings[item.setting]);
    return v > 0 ? v : item.def;
}

/**
 * Where an item stands. rec: { km, at } of the last service, or undefined (never recorded).
 * interval: miles (unit 'mi') or months (unit 'mo'); an oil item also comes due after item.months.
 */
function status(item, rec, odoKm, now, interval) {
    if (!rec) return { known: false };
    const t = now || Date.now();
    const r = { known: true, leftKm: null, leftDays: null, frac: 0 };
    if (item.unit === 'mi') {
        const everyKm = interval * MI;
        if (isFinite(odoKm)) { const used = Math.max(0, odoKm - rec.km); r.leftKm = everyKm - used; r.frac = used / everyKm; }
        if (item.months) { const everyMs = item.months * 30.44 * DAY, used = t - rec.at; r.leftDays = (everyMs - used) / DAY; r.frac = Math.max(r.frac, used / everyMs); }
    } else {
        const everyMs = interval * 30.44 * DAY, used = t - rec.at;
        r.leftDays = (everyMs - used) / DAY; r.frac = used / everyMs;
    }
    r.due = r.frac >= 1;
    r.soon = !r.due && r.frac >= SOON;
    return r;
}

/** "1,240 mi left", "320 mi over", "5 months left" ... for the screen (units 'us' or 'metric'). */
function leftText(r, units) {
    if (!r.known) return 'Not recorded yet';
    const parts = [];
    if (r.leftKm !== null) {
        const us = units !== 'metric', v = Math.round(Math.abs(r.leftKm) / (us ? MI : 1));
        parts.push(commas(v) + (us ? ' mi' : ' km') + (r.leftKm >= 0 ? ' left' : ' over'));
    }
    if (r.leftDays !== null) {
        const d = Math.abs(r.leftDays), txt = d >= 60 ? Math.round(d / 30.44) + ' months' : Math.round(d) + ' days';
        parts.push(txt + (r.leftDays >= 0 ? ' left' : ' over'));
    }
    return parts.join('; ');
}

module.exports = { ITEMS, MI, status, leftText, intervalOf, commas };
