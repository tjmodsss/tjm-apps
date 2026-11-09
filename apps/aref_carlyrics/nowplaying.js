'use strict';
/**
 * nowplaying.js - finds the track the car is playing (Apple Music over CarPlay, Bluetooth, USB...) in the
 * head unit's own SOME/IP interfaces.
 *
 * Nobody has documented which interface and field carry the CarPlay track on iDrive 7, so this module
 * does not assume one. It subscribes to every field of the interfaces app.json declares with "*", keeps
 * the latest value of each, and picks the track out of them by name (title / artist / album / duration /
 * position). It also searches the unit's interface catalog for other interfaces with such fields, so the
 * next version can declare the right one.
 *
 * Read-only: it only subscribes and reads (getValue). It never calls a method or writes a field.
 *
 *   const np = new NowPlaying(ctx.signals, log, IFACES);
 *   await np.start();
 *   np.track()    // { title, artist, album, duration (ms), position (ms) | null, from } or null
 *   np.values()   // [{ key, text, at, changes }], newest first (the Probe page)
 *   np.status()   // [{ iface, instance, available, fields, error }]
 *
 * Node 8: no ?., ??, object spread or optional catch binding.
 */
const fs = require('fs');

const CATALOG = '/etc/oap/someip/someip-interfaces.json';
const MAX_FIELDS = 120;          // per interface instance
const MAX_INSTANCES = 12;        // per interface (BMW's MediaPlayer has one per source: USB, Bluetooth, CarPlay...)
const MAX_DEPTH = 5;             // into a field's struct
const MAX_LEAVES = 60;           // per field value

/* ---------- names that say what a value is ---------- */
// matched against the last part of a leaf's path (camelCase and snake_case both)
const NAME = {
    title: /(title|songname|trackname|song|track)$/i,
    artist: /(artist|artistname|performer|interpret|singer)s?$/i,
    album: /album(name|title)?$/i,
    duration: /(duration|length|totaltime|playtime_?total|totalduration|^total)$/i,
    position: /(position|elapsed|elapsedtime|currenttime|playtime|progress)$/i,
};
// names that are never the song's title (an album's, a station's, a folder's, an app's or a device's)
const NOT_TITLE = /(album|artist|station|folder|playlist|device|app|source|service|genre|chapter|menu|window|screen|popup)/i;
// words that make an interface worth a look in the catalog
const CATALOG_WORDS = /(title|artist|album|nowplaying|metadata|trackinfo|songinfo|interpret)/i;
// fields that name titles that are not playing
const SKIP_FIELD = /^(prev|next|playlist|history|queue|browse|search|list)/i;
// fields whose "position" is a place in a list (currentItemPosition = { position: 3, totalNumber: 20 }), not a time
const NOT_TIME_FIELD = /(itemposition|listposition|index|number|count)/i;

function shortName(iface) { return iface.split('.').pop(); }

/** The instance names a generated interface config names (arrays, objects or one string), else fallback. */
function instancesOf(cfg, fallback) {
    let list = [];
    const ins = cfg && cfg.instances;
    if (Array.isArray(ins)) list = ins.map((x) => (x && typeof x === 'object' ? x.name || x.instance || x.id : x));
    else if (ins && typeof ins === 'object') list = Object.keys(ins);
    else if (typeof ins === 'string' && ins !== '*') list = [ins];
    list = list.filter((x) => typeof x === 'string' || typeof x === 'number').map(String).filter((x) => x && x !== '*');
    (fallback || []).forEach((f) => { if (list.indexOf(f) < 0) list.push(f); });
    // the sources that can carry Apple Music first
    const rank = (x) => (/carplay|apple|iap|projected/i.test(x) ? 0 : /bluetooth|bt|a2dp/i.test(x) ? 1 : 2);
    list.sort((a, b) => rank(a) - rank(b));
    return list.slice(0, MAX_INSTANCES);
}

/** The field names of a generated interface config (fields or attributes). */
function fieldsOf(cfg) {
    const f = (cfg && (cfg.fields || cfg.attributes)) || {};
    return (Array.isArray(f) ? f.map((x) => (x && x.name) || x) : Object.keys(f)).filter((x) => typeof x === 'string').slice(0, MAX_FIELDS);
}

/**
 * Metadata lists as BMW's MediaPlayer may send them, [{ type: 'TITLE', value: 'x' }, ...], made into
 * objects ({ TITLE: 'x' }) so the names match like any other field. Anything else is returned unchanged.
 */
function normalize(v, depth) {
    depth = depth || 0;
    if (!v || typeof v !== 'object' || Buffer.isBuffer(v) || depth > MAX_DEPTH) return v;
    if (Array.isArray(v)) {
        const keyOf = (x) => x && typeof x === 'object' && (x.type || x.key || x.name || x.attribute || x.id);
        const valOf = (x) => (x.value !== undefined ? x.value : x.text !== undefined ? x.text : x.data !== undefined ? x.data : x.stringValue);
        if (v.length && v.every((x) => typeof keyOf(x) === 'string' && valOf(x) !== undefined)) {
            const o = {};
            v.forEach((x) => { const k = keyOf(x); if (o[k] === undefined) o[k] = normalize(valOf(x), depth + 1); });
            return o;
        }
        return v.map((x) => normalize(x, depth + 1));
    }
    // a typed value wrapper, as CarPlay's metadata sends it ({ stringValue: 'x' }, { intValue: 3 }): the value itself
    const ks = Object.keys(v);
    if (ks.length && ks.every((k) => /value$/i.test(k))) {
        const k = ks.filter((x) => v[x] !== null && v[x] !== undefined && v[x] !== '')[0];
        if (k !== undefined && typeof v[k] !== 'object') return v[k];
    }
    const o = {};
    ks.forEach((k) => { o[k] = normalize(v[k], depth + 1); });
    return o;
}

/** Every leaf (string, number, boolean) of a value: [[path, value]], at most MAX_LEAVES. */
function leaves(v, pre, out, depth) {
    out = out || [];
    depth = depth || 0;
    if (out.length >= MAX_LEAVES) return out;
    if (v === null || v === undefined) return out;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') { out.push([pre || '', v]); return out; }
    if (Buffer.isBuffer(v)) { out.push([pre || '', '<' + v.length + ' bytes>']); return out; }
    if (depth >= MAX_DEPTH || typeof v !== 'object') return out;
    if (Array.isArray(v)) {
        v.slice(0, 3).forEach((x, i) => leaves(x, (pre || '') + '[' + i + ']', out, depth + 1));
        return out;
    }
    Object.keys(v).forEach((k) => leaves(v[k], pre ? pre + '.' + k : k, out, depth + 1));
    return out;
}

/** The last name in a leaf path ("a.b[0].songTitle" -> "songTitle"). */
function lastName(p) { const m = /([A-Za-z_][A-Za-z0-9_]*)(\[\d+\])?$/.exec(p); return m ? m[1] : p; }

/** A time value in ms: values over 36000 are taken as ms already, smaller ones as seconds. */
function toMs(n) { return n > 36000 ? n : n * 1000; }

/**
 * A position in ms. With the track's duration known (ms), a value no larger than the duration in
 * seconds is seconds; a larger one is ms already. Without it, as toMs().
 */
function posMs(v, durMs) {
    if (durMs > 0) return v <= durMs / 1000 + 5 ? v * 1000 : v;
    return toMs(v);
}

/**
 * The track in one field's value, or null: { title, artist, album, duration, position, score }.
 * fieldName counts as the path's start (a field named "currentTitle" that is just a string).
 */
function trackIn(fieldName, value) {
    const L = leaves(normalize(value), '');
    const r = { title: '', artist: '', album: '', duration: null, position: null, score: 0 };
    L.forEach((e) => {
        const name = lastName(e[0] || fieldName), v = e[1];
        if (typeof v === 'string') {
            const s = v.trim();
            if (!s || s.length > 200) return;
            if (!r.title && NAME.title.test(name) && !NOT_TITLE.test(name)) r.title = s;
            else if (!r.artist && NAME.artist.test(name)) r.artist = s;
            else if (!r.album && NAME.album.test(name)) r.album = s;
        } else if (typeof v === 'number' && isFinite(v) && v >= 0) {
            if (r.duration === null && NAME.duration.test(name) && v > 0) r.duration = toMs(v);
            else if (r.position === null && NAME.position.test(name)) r.position = v;
        }
    });
    if (!r.title) return null;
    r.score = 2 + (r.artist ? 2 : 0) + (r.album ? 1 : 0) + (r.duration ? 1 : 0);
    if (r.position !== null) r.position = posMs(r.position, r.duration);
    return r;
}

/** Display text for a value (the Probe page): short, one line. */
function textOf(v) {
    let s;
    if (v === null || v === undefined) s = String(v);
    else if (typeof v === 'object') { try { s = JSON.stringify(v); } catch (e) { s = '[object]'; } } else s = String(v);
    s = s.replace(/\s+/g, ' ');
    return s.length > 160 ? s.slice(0, 157) + '...' : s;
}

class NowPlaying {
    /**
     * signals: ctx.signals (kit/runtime/signals.js). ifaces: [{ iface, instances: [fallback names] }],
     * each declared in app.json "signals" (with "*", so the install generates every field).
     */
    constructor(signals, log, ifaces) {
        this.signals = signals;
        this.log = log;
        this.ifaces = ifaces;
        this.store = new Map();      // "Iface/inst.field" -> { iface, inst, field, value, text, at, changes }
        this.subs = [];              // status rows
        this.logged = new Set();     // keys whose first value was logged
        this.lastLog = new Map();    // key -> ms of the last change logged
        this.onChangeFns = [];
    }

    onChange(fn) { this.onChangeFns.push(fn); }

    async start() {
        for (const d of this.ifaces) {
            let cfg = null, err = null;
            try { cfg = this.signals.loadConfig(d.iface); } catch (e) { err = String(e.message || e); }
            if (!cfg) {
                this.subs.push({ iface: d.iface, instance: '-', available: false, fields: 0, error: err || 'no config' });
                this.log.warn('nowplaying: ' + d.iface + ': ' + err);
                continue;
            }
            const fields = fieldsOf(cfg), insts = instancesOf(cfg, d.instances);
            this.log.info('nowplaying: ' + d.iface + ': ' + fields.length + ' fields, instances ' + JSON.stringify(insts));
            if (!insts.length) insts.push('1');
            for (const inst of insts) {
                const row = { iface: d.iface, instance: inst, available: false, fields: fields.length, error: '' };
                this.subs.push(row);
                const handlers = {};
                fields.forEach((f) => { handlers[f] = (v) => this._put(d.iface, inst, f, v); });
                try {
                    const sub = await this.signals.watch(d.iface, inst, handlers, this.log, { pollMs: 30000 });
                    row.sub = sub;
                    row.error = sub && sub.error ? sub.error : '';
                } catch (e) {
                    row.error = String(e.message || e);
                }
            }
        }
        // availability changes after the watch: read it again for the Probe page
        this.timer = setInterval(() => { this.subs.forEach((r) => { if (r.sub) r.available = !!r.sub.available; }); }, 1000);
        if (this.timer.unref) this.timer.unref();
    }

    stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }

    _put(iface, inst, field, value) {
        const key = shortName(iface) + '/' + inst + '.' + field;
        const text = textOf(value), now = Date.now();
        const old = this.store.get(key);
        if (old && old.text === text) { old.seen = now; return; }
        this.store.set(key, { iface, inst, field, value, text, at: now, seen: now, changes: old ? old.changes + 1 : 0 });
        // the log: every field's first value, then changes at most every 10 s per field
        if (!this.logged.has(key)) { this.logged.add(key); this.log.info('value ' + key + ' = ' + text); } else if (now - (this.lastLog.get(key) || 0) > 10000) {
            this.lastLog.set(key, now);
            this.log.info('change ' + key + ' = ' + text);
        }
        this.onChangeFns.forEach((fn) => { try { fn(key); } catch (e) { this.log.warn('nowplaying onChange: ' + e.message); } });
    }

    /**
     * The track from BMW's MediaPlayer as it reports it (CarPlay included: instance CarPlayMedia), or null:
     * currentItemMetadata [{ key: 'TITLE', value: { stringValue } }...], currentItemTime { elapsed, total }
     * in ms, playerState PLAYER_STATE_PLAY / _PAUSE / _STOP. The instance that plays wins, CarPlay first.
     */
    player() {
        const groups = new Map();       // "Iface/inst" -> { meta, time, state, speed }
        this.store.forEach((e, key) => {
            const g = key.slice(0, key.lastIndexOf('.'));
            if (!groups.has(g)) groups.set(g, { from: g });
            const o = groups.get(g);
            if (e.field === 'currentItemMetadata') { o.meta = normalize(e.value); o.metaAt = e.at; o.metaKey = key; }
            else if (e.field === 'currentItemTime') { o.time = e.value; o.timeAt = e.at; }
            else if (e.field === 'playerState') o.state = String(e.value);
            else if (e.field === 'playbackSpeed') o.speed = Number(e.value);
        });
        let best = null;
        groups.forEach((o) => {
            const m = o.meta;
            if (!m || typeof m !== 'object' || Array.isArray(m)) return;
            const pick = (re) => { const k = Object.keys(m).filter((x) => re.test(x))[0]; return k && typeof m[k] === 'string' ? m[k].trim() : ''; };
            const title = pick(/^title$/i);
            if (!title) return;
            const playing = /PLAY$/.test(o.state || '') && o.speed !== 0;
            const t = o.time && typeof o.time === 'object' ? o.time : null;
            const r = {
                title: title, artist: pick(/^artist$/i), album: pick(/^album$/i), cover: pick(/^cover_?file$/i),
                duration: t && t.total > 0 ? Number(t.total) : null,
                position: t && t.elapsed >= 0 ? Number(t.elapsed) : null, positionAt: o.timeAt || o.metaAt,
                playing: playing, state: o.state || '', at: Math.max(o.metaAt || 0, o.timeAt || 0), from: o.metaKey, direct: true,
                score: (playing ? 20 : 0) + (/carplay|projected/i.test(o.from) ? 2 : 0),
            };
            if (r.duration && r.position !== null && r.duration < 36000 && r.position < 36000) { r.duration *= 1000; r.position *= 1000; }   // seconds (an older unit)
            if (!best || r.score > best.score || (r.score === best.score && r.at > best.at)) best = r;
        });
        return best;
    }

    /** The best track among every value seen, or null. */
    track() {
        const direct = this.player();
        if (direct) return direct;
        let best = null;
        this.store.forEach((e, key) => {
            // the previous and next items, playlists and queues name titles too: not what is playing
            if (SKIP_FIELD.test(e.field)) return;
            const t = trackIn(e.field, e.value);
            if (!t) return;
            // newer values win a tie: the source that is playing changes most
            if (!best || t.score > best.score || (t.score === best.score && e.at > best.at)) {
                best = { title: t.title, artist: t.artist, album: t.album, duration: t.duration, position: t.position, score: t.score, at: e.at, from: key };
            }
        });
        if (!best) return null;
        // a duration in another field of the same interface instance (currentItemTime.total, say)
        if (!best.duration) {
            const pre0 = best.from.slice(0, best.from.lastIndexOf('.'));
            this.store.forEach((e, key) => {
                if (best.duration || key.indexOf(pre0 + '.') !== 0 || SKIP_FIELD.test(e.field)) return;
                leaves(normalize(e.value), '').forEach((l) => {
                    if (!best.duration && typeof l[1] === 'number' && l[1] > 0 && NAME.duration.test(lastName(l[0] || e.field))) best.duration = toMs(l[1]);
                });
            });
        }
        // a position in another field of the same interface instance (a struct of its own, ticking)
        if (best.position === null) {
            const pre = best.from.slice(0, best.from.lastIndexOf('.'));
            this.store.forEach((e, key) => {
                if (best.position !== null || key.indexOf(pre + '.') !== 0 || SKIP_FIELD.test(e.field) || NOT_TIME_FIELD.test(e.field)) return;
                if (typeof e.value === 'number' && NAME.position.test(e.field)) best.position = posMs(e.value, best.duration);
                else if (e.value && typeof e.value === 'object') {
                    leaves(normalize(e.value), '').forEach((l) => {
                        if (best.position === null && typeof l[1] === 'number' && NAME.position.test(lastName(l[0] || e.field))) best.position = posMs(l[1], best.duration);
                    });
                }
                if (best.position !== null) best.positionAt = e.at;
            });
        } else best.positionAt = best.at;
        return best;
    }

    /** Every value seen, newest first. */
    values() {
        const list = [];
        this.store.forEach((e, key) => list.push({ key, text: e.text, at: e.at, changes: e.changes }));
        list.sort((a, b) => b.at - a.at);
        return list;
    }

    status() { return this.subs.map((r) => ({ iface: r.iface, instance: r.instance, available: r.available, fields: r.fields, error: r.error })); }
}

/**
 * Read-only search of the unit's interface catalog for interfaces whose definition names a title,
 * an artist, an album or now-playing data: [{ iface, words: [...] }], at most 40. file: for tests.
 */
function scanCatalog(file) {
    let db;
    try { db = JSON.parse(fs.readFileSync(file || CATALOG, 'utf8')); } catch (e) { return { error: String(e.code || e.message), hits: [] }; }
    const all = (db && db.interfaces) || db || {};
    const hits = [];
    Object.keys(all).forEach((name) => {
        let text;
        try { text = JSON.stringify(all[name]); } catch (e) { return; }
        const words = {};
        const re = /"([A-Za-z_][A-Za-z0-9_]{2,60})"/g;
        for (let m = re.exec(text); m; m = re.exec(text)) if (CATALOG_WORDS.test(m[1])) words[m[1]] = true;
        const w = Object.keys(words);
        if (w.length) hits.push({ iface: name, words: w.slice(0, 12), n: w.length });
    });
    // media and CarPlay first, then by how many such names
    const media = (h) => (/(carplay|a4a|media|entertainment|audio|music|player)/i.test(h.iface) ? 1 : 0);
    hits.sort((a, b) => media(b) - media(a) || b.n - a.n);
    return { error: '', hits: hits.slice(0, 40), total: Object.keys(all).length };
}

module.exports = { NowPlaying, scanCatalog, trackIn, leaves, instancesOf, fieldsOf, textOf, posMs, normalize };
