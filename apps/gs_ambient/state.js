'use strict';
/**
 * state.js - what the user set: the colours of both zones, brightness, the zone the wheel edits, the
 * running effect and every effect's settings, the favourite groups. Saved as JSON 500 ms after the last change
 * (temp file + rename: a power cut leaves the old file whole). Effect settings whose key starts with
 * "fav" hold a favourite's index.
 */
const fs = require('fs');

const MAX_FAVS = 8;
const MAX_GROUPS = 6;
const MAX_NAME = 18;
const DEFAULTS = { v: 1, upper: { h: 0, s: 1 }, lower: { h: 220, s: 1 }, brightness: 0.8, zone: 'upper', effect: null, params: {}, favs: [] };

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const copy = (o) => JSON.parse(JSON.stringify(o));
const isNum = (x) => typeof x === 'number' && isFinite(x);
const colorOk = (c) => !!c && isNum(c.h) && isNum(c.s);
const normColor = (c, dflt) => (colorOk(c) ? { h: ((c.h % 360) + 360) % 360, s: clamp(c.s, 0, 1) } : copy(dflt));

function normFavs(list) {
    return Array.isArray(list) ? list.filter((f) => f && colorOk(f.upper) && colorOk(f.lower)).slice(0, MAX_FAVS)
        .map((f) => ({ upper: normColor(f.upper), lower: normColor(f.lower) })) : [];
}
function cleanName(name) {
    const s = String(name || '').trim().replace(/\s+/g, ' ').slice(0, MAX_NAME);
    return s;
}
function normGroup(g) {
    if (!g || typeof g !== 'object') return null;
    const name = cleanName(g.name) || 'Favoriten';
    return { name, favs: normFavs(g.favs) };
}
function sanitize(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    let groups = Array.isArray(r.groups) ? r.groups.map(normGroup).filter(Boolean).slice(0, MAX_GROUPS) : [];
    if (!groups.length) groups = [{ name: 'Favoriten', favs: normFavs(r.favs) }];
    let group = isNum(r.group) ? Math.round(r.group) : 0;
    if (group < 0 || group >= groups.length) group = 0;
    return {
        v: 1,
        upper: normColor(r.upper, DEFAULTS.upper),
        lower: normColor(r.lower, DEFAULTS.lower),
        brightness: isNum(r.brightness) ? clamp(r.brightness, 0.05, 1) : DEFAULTS.brightness,
        zone: r.zone === 'lower' ? 'lower' : 'upper',
        effect: typeof r.effect === 'string' ? r.effect : null,
        params: r.params && typeof r.params === 'object' ? copy(r.params) : {},
        group,
        groups,
        favs: groups[group].favs,
    };
}

function createState(file, opts) {
    const o = opts || {};
    const log = o.log || { warn() {}, info() {} };
    const timers = o.timers || { setTimeout, clearTimeout };
    let s;
    try {
        s = sanitize(JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch (e) {
        if (e.code !== 'ENOENT') log.warn('state: ' + file + ' unreadable, using the defaults: ' + e.message);
        s = sanitize(null);
    }
    const listeners = [];
    let timer = null;
    const save = () => {
        timer = null;
        try { fs.writeFileSync(file + '.tmp', JSON.stringify(s)); fs.renameSync(file + '.tmp', file); } catch (e) { log.warn('state save: ' + e.message); }
    };
    const changed = () => {
        if (timer !== null) timers.clearTimeout(timer);
        timer = timers.setTimeout(save, 500);
        listeners.forEach((fn) => { try { fn(); } catch (e) { log.warn('state listener: ' + e.message); } });
    };
    const other = (z) => (z === 'upper' ? 'lower' : 'upper');
    return {
        MAX_FAVS,
        MAX_GROUPS,
        get: () => copy(s),
        onChange(fn) { listeners.push(fn); },
        flush() { if (timer !== null) { timers.clearTimeout(timer); save(); } },
        setColor(zone, c) { const z = zone === 'lower' ? 'lower' : 'upper'; s[z] = normColor(c, s[z]); changed(); },
        setZone(z) { s.zone = z === 'lower' ? 'lower' : 'upper'; changed(); },
        setBrightness(b) { if (isNum(b)) { s.brightness = clamp(b, 0.05, 1); changed(); } },
        swap() { const u = s.upper; s.upper = s.lower; s.lower = u; changed(); },
        same() { s[other(s.zone)] = copy(s[s.zone]); changed(); },
        setEffect(id) { s.effect = id || null; changed(); },
        param(id, key, dflt) { const p = s.params[id]; return p && p[key] !== undefined ? p[key] : dflt; },
        setParam(id, key, v) { (s.params[id] = s.params[id] || {})[key] = v; changed(); },
        addFav() {
            if (s.favs.length >= MAX_FAVS) return -1;
            s.favs.push({ upper: copy(s.upper), lower: copy(s.lower) });
            changed();
            return s.favs.length - 1;
        },
        cycleGroup(dir) {
            if (s.groups.length < 2) return;
            const n = s.groups.length;
            s.group = ((s.group + (dir || 1)) % n + n) % n;
            s.favs = s.groups[s.group].favs;
            changed();
        },
        setGroup(i) {
            if (!(i >= 0 && i < s.groups.length) || i === s.group) return;
            s.group = i;
            s.favs = s.groups[i].favs;
            changed();
        },
        addGroup(name) {
            const clean = cleanName(name);
            if (!clean || s.groups.length >= MAX_GROUPS) return -1;
            const favs = [];
            s.groups.push({ name: clean, favs });
            s.group = s.groups.length - 1;
            s.favs = favs;
            changed();
            return s.group;
        },
        renameGroup(name) {
            const clean = cleanName(name);
            if (!clean) return false;
            s.groups[s.group].name = clean;
            changed();
            return true;
        },
        deleteGroup(i) {
            if (s.groups.length < 2 || !(i >= 0 && i < s.groups.length)) return;
            s.groups.splice(i, 1);
            if (s.group > i) s.group -= 1;
            if (s.group >= s.groups.length) s.group = s.groups.length - 1;
            s.favs = s.groups[s.group].favs;
            changed();
        },
        removeFav(i) {
            if (!(i >= 0 && i < s.favs.length)) return;
            s.favs.splice(i, 1);
            Object.keys(s.params).forEach((id) => {
                const p = s.params[id];
                Object.keys(p).forEach((k) => { if (/^fav/.test(k) && isNum(p[k]) && p[k] >= i) p[k] = -1; });
            });
            changed();
        },
        applyFav(i) { const f = s.favs[i]; if (!f) return; s.upper = copy(f.upper); s.lower = copy(f.lower); changed(); },
    };
}

function readState(file) {
    try { return sanitize(JSON.parse(fs.readFileSync(file, 'utf8'))); } catch (e) { return null; }
}

module.exports = { createState, readState, MAX_FAVS, MAX_GROUPS, MAX_NAME };
