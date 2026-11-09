'use strict';
/**
 * catalog.js - searches the head unit's SOME/IP interface catalog for the services behind a car feature
 * (ambient light, route guidance, GPS position...), with no car in it (so it can be tested on a PC).
 *
 * The catalog (/etc/oap/someip/someip-interfaces.json) is the list MainApp installs every app against: each
 * interface with its fields, methods and broadcasts. An app can only use what is in it, so finding a
 * feature's interface here is the first step to an app for that feature. Reading the file changes nothing.
 *
 *   const r = search(catalogJson, TOPICS.ambient)  -> [{ iface, score, names: [matching member names], def }]
 *
 * Node 8: no ?., ??, object spread or optional catch binding.
 */

// what each topic looks for: in interface names (iface) and in the names inside a definition (member)
const TOPICS = {
    ambient: { name: 'Ambient light', iface: /ambien|interiorlight|innenlicht|lightcolou?r|lighting|lin_?rgb/i, member: /ambien|colou?r|rgb|hue|brightness|lightprofile|lightscene|innenlicht/i },
    route: { name: 'Route guidance and ETA', iface: /navigation|guidance|route|carplay|projected/i, member: /eta|arrival|timetodest|remainingtime|remainingdistance|distancetodest|destination|maneuver|manoeuvre|guidance/i },
    gps: { name: 'GPS position', iface: /position|location|gnss|gps|navigation/i, member: /latitude|longitude|heading|altitude|gnss|gps|wgs|position|velocity|groundspeed|speedoverground|course/i },
    media: { name: 'Media now playing', iface: /media|entertainment|carplay|audio|player|tuner/i, member: /title|artist|album|nowplaying|metadata|trackinfo|playtime|elapsed/i },
    climate: { name: 'Climate', iface: /climate|hvac|ihka|klima|airconditioning/i, member: /temperature|fan|blower|airflow|seatheat|ventilat|defrost|setpoint/i },
    lights: { name: 'Exterior lights', iface: /light|lamp|flm|headlight|welcome/i, member: /welcome|daytime|drl|lowbeam|highbeam|headlight|cominghome|leavinghome/i },
    body: { name: 'Doors, locks, windows', iface: /door|lock|window|body|bdc|central/i, member: /door|lock|window|trunk|tailgate|mirror|sunroof/i },
    fuel: { name: 'Fuel, range, odometer', iface: /kombi|fuel|tank|range|bordcomputer/i, member: /fuel|tank|range|mileage|odometer|consumption/i },
};
const ORDER = ['ambient', 'route', 'gps', 'media', 'climate', 'lights', 'body', 'fuel'];

/** Every JSON key (any depth) in a definition, with how it is used (a field, a method, a broadcast...). */
function namesIn(def) {
    const out = {};
    const CAT = (lk) => (/^(attributes|fields)$/.test(lk) ? 'field' : /^methods$/.test(lk) ? 'method' : /^(broadcasts|events)$/.test(lk) ? 'broadcast' : /^(types|structs|enumerations|enums)$/.test(lk) ? 'type' : '');
    // the names directly under a category ("attributes": { statusX: ... }) are the members; arrays of
    // names ("methods": ["getX"]) too; everything deeper is a member's own description
    const walk = (v, cat, depth) => {
        if (!v || typeof v !== 'object' || depth > 8) return;
        if (Array.isArray(v)) { v.forEach((x) => { if (cat && typeof x === 'string' && !out[x]) out[x] = cat; else walk(x, '', depth + 1); }); return; }
        Object.keys(v).forEach((k) => {
            if (cat) { if (!out[k]) out[k] = cat; walk(v[k], '', depth + 1); return; }
            walk(v[k], CAT(k.toLowerCase()), depth + 1);
        });
    };
    walk(def, '', 0);
    return out;
}

/**
 * Every member of a definition with what the catalog says about it: [[name, kind, description]], fields
 * first. The description is the member's own JSON (getter / setter / notifier flags, its type, its
 * arguments), whatever shape the catalog gives it.
 */
function membersOf(def) {
    const out = [];
    const CAT = (lk) => (/^(attributes|fields)$/.test(lk) ? 'field' : /^methods$/.test(lk) ? 'method' : /^(broadcasts|events)$/.test(lk) ? 'broadcast' : '');
    const walk = (v, depth) => {
        if (!v || typeof v !== 'object' || depth > 4) return;
        Object.keys(v).forEach((k) => {
            const cat = CAT(k.toLowerCase());
            if (!cat) { if (!Array.isArray(v)) walk(v[k], depth + 1); return; }
            const m = v[k];
            if (Array.isArray(m)) m.forEach((x) => { if (typeof x === 'string') out.push([x, cat, null]); else if (x && x.name) out.push([x.name, cat, x]); });
            else if (m && typeof m === 'object') Object.keys(m).forEach((n) => out.push([n, cat, m[n]]));
        });
    };
    walk(def, 0);
    const order = { field: 0, method: 1, broadcast: 2 };
    out.sort((a, b) => order[a[1]] - order[b[1]] || (a[0] < b[0] ? -1 : 1));
    return out;
}

/** Interfaces matching a topic, best first: [{ iface, score, names: [[name, kind]], fields, methods, broadcasts, def }]. */
function search(db, topic, max) {
    const all = (db && db.interfaces) || db || {};
    const hits = [];
    Object.keys(all).forEach((iface) => {
        const def = all[iface];
        const names = namesIn(def);
        const match = Object.keys(names).filter((n) => topic.member.test(n));
        const byName = topic.iface.test(iface);
        if (!match.length && !byName) return;
        if (!match.length && byName && !Object.keys(names).length) return;
        const count = (kind) => Object.keys(names).filter((n) => names[n] === kind).length;
        hits.push({
            iface, score: match.length * 2 + (byName ? 3 : 0), names: match.slice(0, 30).map((n) => [n, names[n]]),
            fields: count('field'), methods: count('method'), broadcasts: count('broadcast'), def,
        });
    });
    hits.sort((a, b) => b.score - a.score || (a.iface < b.iface ? -1 : 1));
    return hits.slice(0, max || 40);
}

/** The report text for every topic: the matches, and the first definitions in full (capped). */
function report(db, total, opts) {
    const L = [];
    const showDefs = (opts && opts.defs) || 6, cap = (opts && opts.cap) || 4000;
    ORDER.forEach((k) => {
        const T = TOPICS[k], hits = search(db, T, 40);
        L.push('', '==== ' + T.name + ': ' + hits.length + ' interfaces');
        hits.forEach((h, i) => {
            L.push((i + 1) + '. ' + h.iface + '  (' + h.fields + ' fields, ' + h.methods + ' methods, ' + h.broadcasts + ' broadcasts)');
            if (h.names.length) L.push('   matches: ' + h.names.map((n) => n[0] + (n[1] ? ' [' + n[1] + ']' : '')).join(', '));
        });
        hits.slice(0, showDefs).forEach((h) => {
            let j;
            try { j = JSON.stringify(h.def); } catch (e) { j = '(not JSON)'; }
            L.push('--- ' + h.iface + ' definition' + (j.length > cap ? ' (first ' + cap + ' of ' + j.length + ' characters)' : ''), j.slice(0, cap));
        });
    });
    return L.join('\n');
}

module.exports = { TOPICS, ORDER, search, report, namesIn, membersOf };
