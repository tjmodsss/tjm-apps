'use strict';
/**
 * ha.js - a small Home Assistant client for the head unit (node 8: only http / https, no fetch).
 *
 * Config: <data dir>/ha.json (never in the code, never logged):
 *   { "url": "http://homeassistant.local:8123",   the address the CAR can reach (Nabu Casa, VPN, ...)
 *     "token": "<long-lived access token>",       Profile > Security in Home Assistant
 *     "control": false,                           false = READ ONLY (default): states only, nothing is switched
 *                                                 (true = may switch, but ONLY entries with "allow": true)
 *     "webhookId": "",                            for "car data -> Home Assistant" (automation webhook trigger)
 *     "allowDemoSend": false,                     true = also send the simulated demo drive (tests only)
 *     "entities": [ { "entity": "light.wohnzimmer", "name": "Wohnzimmer", "allow": true, "confirm": false } ] }
 * Without ha.json the app runs a built-in DEMO and touches no network.
 *
 * Safety rules (they cannot be switched off from the screen):
 *  - nothing is switched unless "control" is true AND the entry itself says "allow": true;
 *  - only harmless domains switch directly: light, switch, input_boolean, fan, scene, script, button;
 *  - lock, cover (garage door!) and alarm_control_panel switch only with "confirm": true on that entity,
 *    and then only after a second tap on the tile;
 *  - everything else is shown, never switched.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const nodeUrl = require('url');

const SERVICE = { light: 'toggle', switch: 'toggle', input_boolean: 'toggle', fan: 'toggle', scene: 'turn_on', script: 'turn_on', button: 'press' };
const NEEDS_CONFIRM = ['lock', 'cover', 'alarm_control_panel'];
const KINDS = ['light', 'switch', 'input_boolean', 'fan', 'scene', 'script', 'button', 'cover', 'lock', 'sensor', 'binary_sensor', 'climate'];
const MAX_TILES = 24;
const atomicWrite = (file, text) => { const tmp = file + '.tmp-' + process.pid; fs.writeFileSync(tmp, text, { encoding: 'utf8', mode: 0o600 }); fs.renameSync(tmp, file); };

const DEMO = [
    { entity: 'light.wohnzimmer', name: 'Wohnzimmer', state: 'on', attrs: { bri: 80, caps: { bri: true, color: true, ct: true }, rgb: [255, 180, 90], kelvin: 2700 } },
    { entity: 'light.kueche', name: 'Küche', state: 'off', attrs: { bri: 100, caps: { bri: true, color: false, ct: true }, rgb: null, kelvin: 4000 } },
    { entity: 'switch.kaffeemaschine', name: 'Kaffeemaschine', state: 'off' },
    { entity: 'scene.gute_nacht', name: 'Gute Nacht', state: 'scening' },
    { entity: 'script.ankommen', name: 'Ankommen', state: 'off' },
    { entity: 'cover.garagentor', name: 'Garagentor', state: 'closed', confirm: true },
    { entity: 'lock.haustuer', name: 'Haustür', state: 'locked', confirm: true },
    { entity: 'sensor.wohnzimmer_temperatur', name: 'Wohnzimmer', state: '21.5', unit: '°C' },
];

const DEMO_EXTRA = [
    { entity: 'light.schlafzimmer', name: 'Schlafzimmer', state: 'off' },
    { entity: 'light.buero', name: 'Buero', state: 'on' },
    { entity: 'switch.steckdose_buero', name: 'Steckdose Buero', state: 'off' },
    { entity: 'scene.film', name: 'Film', state: 'scening' },
    { entity: 'script.alles_aus', name: 'Alles aus', state: 'off' },
    { entity: 'sensor.aussentemperatur', name: 'Aussen', state: '14.2', unit: '°C' },
    { entity: 'binary_sensor.fenster_wohnzimmer', name: 'Fenster Wohnzimmer', state: 'off' },
];

const COLOR_MODES = ['hs', 'xy', 'rgb', 'rgbw', 'rgbww'];
/** What a light can do, from its Home Assistant attributes: { bri (0-100 or null), caps: { bri, color, ct }, rgb, kelvin }. */
function lightAttrs(a) {
    a = a || {};
    const modes = Array.isArray(a.supported_color_modes) ? a.supported_color_modes : [];
    let color = modes.some((m) => COLOR_MODES.indexOf(m) >= 0);
    if (!color && Array.isArray(a.rgb_color)) color = true;
    let ct = modes.indexOf('color_temp') >= 0 || color;
    if (!ct && typeof a.color_temp_kelvin === 'number') ct = true;
    let bri = modes.some((m) => m !== 'onoff');
    if (!bri && typeof a.brightness === 'number') bri = true;
    if (modes.length === 0 && !color && !ct && !bri) bri = true;
    return { bri: typeof a.brightness === 'number' ? Math.round(a.brightness / 255 * 100) : null, caps: { bri, color, ct },
        rgb: Array.isArray(a.rgb_color) ? a.rgb_color : null, kelvin: typeof a.color_temp_kelvin === 'number' ? a.color_temp_kelvin : null };
}

/** One request. Resolves { ok, status, data, error } and never rejects; the token only goes in the header. */
function request(base, token, method, p, body) {
    return new Promise((resolve) => {
        let u;
        try { u = new nodeUrl.URL(base); } catch (e) { return resolve({ ok: false, error: 'Adresse ungültig' }); }
        const lib = u.protocol === 'https:' ? https : u.protocol === 'http:' ? http : null;
        if (!lib || !u.hostname) return resolve({ ok: false, error: 'Adresse ungültig' });
        const payload = body === undefined ? null : JSON.stringify(body);
        const headers = { Accept: 'application/json' };
        if (token) headers.Authorization = 'Bearer ' + token;
        if (payload) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(payload); }
        const basePath = (u.pathname || '/').replace(/\/+$/, '');
        const req = lib.request({ hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: basePath + p, method, headers, timeout: 6000 }, (res) => {
            let buf = '';
            res.setEncoding('utf8');
            res.on('data', (d) => { buf += d; if (buf.length > 2e6) req.abort(); });
            res.on('end', () => {
                let data = null;
                try { data = buf ? JSON.parse(buf) : null; } catch (e) { data = null; }
                const ok = res.statusCode >= 200 && res.statusCode < 300;
                resolve({ ok, status: res.statusCode, data, error: ok ? '' : res.statusCode === 401 ? 'Token abgelehnt (401)' : res.statusCode === 404 ? 'Nicht gefunden (404)' : 'Fehler ' + res.statusCode });
            });
        });
        req.on('timeout', () => { req.abort(); resolve({ ok: false, error: 'Zeitüberschreitung' }); });
        req.on('error', (e) => resolve({ ok: false, error: e && e.code === 'ENOTFOUND' ? 'Adresse nicht gefunden' : e && e.code === 'ECONNREFUSED' ? 'Verbindung abgelehnt' : 'Keine Verbindung' }));
        if (payload) req.write(payload);
        req.end();
    });
}

class HA {
    constructor(dataDir, log) {
        this.file = path.join(dataDir, 'ha.json');
        this.log = log || { info() {}, warn() {}, error() {} };
        this.cfg = null;
        this.mode = 'none';          // 'demo' | 'live' | 'error'
        this.err = '';               // the last problem, as a short line
        this.reachable = null;       // null = not asked yet
        this.lastPoll = 0;
        this.states = {};
        this.list = [];
        this.sent = { count: 0, lastAt: 0, ok: null, text: '' };
        this.load();
    }

    load() {
        this.err = '';
        this.reachable = null;
        let raw = null;
        try { raw = fs.readFileSync(this.file, 'utf8'); } catch (e) { raw = null; }
        if (raw === null) {
            this.mode = 'demo';
            this.cfg = { control: true, entities: DEMO, webhookId: 'demo', demo: true };
            this.list = DEMO.map((d) => ({ entity: d.entity, name: d.name, confirm: !!d.confirm, allow: true }));
            this.states = {};
            DEMO.forEach((d) => { this.states[d.entity] = { state: d.state, unit: d.unit, attrs: d.attrs ? JSON.parse(JSON.stringify(d.attrs)) : null }; });
            return;
        }
        try {
            const c = JSON.parse(raw);
            if (!c.url || !c.token) throw new Error('url / token fehlt');
            this.cfg = { url: String(c.url).replace(/\/+$/, ''), token: String(c.token), control: c.control === true, webhookId: c.webhookId ? String(c.webhookId) : '',
                allowDemoSend: c.allowDemoSend === true, entities: Array.isArray(c.entities) ? c.entities : [] };
            this.list = this.cfg.entities.filter((e) => e && typeof e.entity === 'string' && e.entity.indexOf('.') > 0).slice(0, 24)
                .map((e) => ({ entity: e.entity, name: e.name || e.entity.split('.')[1], confirm: e.confirm === true, allow: e.allow === true }));
            this.mode = 'live';
            this.states = {};
        } catch (e) {
            this.mode = 'error';
            this.cfg = null;
            this.list = [];
            this.err = 'ha.json fehlerhaft: ' + (e && e.message ? e.message : 'ungültig');
        }
    }

    host() { try { return this.cfg && this.cfg.url ? new nodeUrl.URL(this.cfg.url).host || '' : ''; } catch (e) { return ''; } }

    /** The tiles, with what each may do. */
    tiles() {
        return this.list.map((e) => {
            const s = this.states[e.entity] || null;
            const domain = e.entity.split('.')[0];
            const state = s ? String(s.state) : '';
            const available = !!s && state !== 'unavailable' && state !== 'unknown';
            const direct = Object.prototype.hasOwnProperty.call(SERVICE, domain);
            const guarded = NEEDS_CONFIRM.indexOf(domain) >= 0;
            const control = !!(this.cfg && this.cfg.control);
            let why = '';
            if (!control) why = 'nur lesen';
            else if (!e.allow) why = 'nicht freigegeben';
            else if (!direct && !(guarded && e.confirm)) why = guarded ? 'gesperrt' : 'nur Anzeige';
            const attrs = s && s.attrs ? s.attrs : null, canAct = why === '';
            return { entity: e.entity, name: e.name, domain, state, unit: s && s.unit ? s.unit : '', available, canAct, why, needsConfirm: guarded, confirm: e.confirm,
                tune: domain === 'light' && canAct && available, light: attrs || { bri: null, caps: { bri: true, color: false, ct: false }, rgb: null, kelvin: null } };
        });
    }

    async poll() {
        if (this.mode !== 'live') return;
        let fails = 0, last = '';
        for (let i = 0; i < this.list.length; i++) {
            const id = this.list[i].entity;
            const r = await request(this.cfg.url, this.cfg.token, 'GET', '/api/states/' + encodeURIComponent(id));
            if (r.ok && r.data) this.states[id] = { state: r.data.state, unit: r.data.attributes && r.data.attributes.unit_of_measurement, attrs: id.indexOf('light.') === 0 ? lightAttrs(r.data.attributes) : null };
            else { fails++; last = r.error; if (r.status !== 404) break; }
        }
        this.lastPoll = Date.now();
        this.reachable = fails < this.list.length || this.list.length === 0;
        if (this.list.length === 0) {
            const r = await request(this.cfg.url, this.cfg.token, 'GET', '/api/');
            this.reachable = r.ok;
            this.err = r.ok ? '' : r.error;
        } else this.err = fails ? last : '';
    }

    /** Press tile i. Resolves { ok, text }. */
    async press(i) {
        const t = this.tiles()[i];
        if (!t) return { ok: false, text: 'Kein Eintrag' };
        if (!t.canAct) return { ok: false, text: t.why === 'nur lesen' ? 'Nur-Lesen-Modus: es wird nichts geschaltet' : 'Dieser Eintrag ist nicht freigegeben' };
        if (this.mode === 'demo') {
            const s = this.states[t.entity];
            if (s.state === 'on') s.state = 'off'; else if (s.state === 'off') s.state = 'on';
            else if (s.state === 'locked') s.state = 'unlocked'; else if (s.state === 'unlocked') s.state = 'locked';
            else if (s.state === 'closed') s.state = 'open'; else if (s.state === 'open') s.state = 'closed';
            return { ok: true, text: t.name + ': ' + ({ on: 'AN', off: 'AUS', locked: 'verriegelt', unlocked: 'entriegelt', open: 'offen', closed: 'zu' }[s.state] || s.state) };
        }
        let service = SERVICE[t.domain];
        if (t.domain === 'lock') service = t.state === 'locked' ? 'unlock' : 'lock';
        else if (t.domain === 'cover') service = t.state === 'open' ? 'close_cover' : 'open_cover';
        else if (t.domain === 'alarm_control_panel') return { ok: false, text: 'Alarmanlage wird nicht geschaltet' };
        if (!service) return { ok: false, text: 'Nicht unterstützt' };
        const r = await request(this.cfg.url, this.cfg.token, 'POST', '/api/services/' + t.domain + '/' + service, { entity_id: t.entity });
        this.log.info('ha service ' + t.domain + '.' + service + ' -> ' + (r.ok ? 'ok' : r.error));
        if (r.ok) await this.poll();
        return { ok: r.ok, text: r.ok ? t.name + ' geschaltet' : r.error };
    }

    /** Set a light on tile i: { bri: 1-100 } and / or { rgb: [r, g, b] } or { kelvin: 1500-6500 }. Only for lights that may be switched. Resolves { ok, text }. */
    async light(i, d) {
        const t = this.tiles()[i];
        if (!t || t.domain !== 'light') return { ok: false, text: 'Kein Licht' };
        if (!t.canAct) return { ok: false, text: t.why === 'nur lesen' ? 'Nur-Lesen-Modus: es wird nichts geschaltet' : 'Dieser Eintrag ist nicht freigegeben' };
        const body = { entity_id: t.entity }, int = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(n))));
        if (d.bri !== undefined) body.brightness_pct = int(d.bri, 1, 100);
        if (Array.isArray(d.rgb) && d.rgb.length === 3) body.rgb_color = d.rgb.map((c) => int(c, 0, 255));
        else if (d.kelvin !== undefined) body.color_temp_kelvin = int(d.kelvin, 1500, 6500);
        if (Object.keys(body).length < 2) return { ok: false, text: 'Nichts zu setzen' };
        if (this.states[t.entity]) {
            const s = this.states[t.entity];
            s.state = 'on';
            s.attrs = s.attrs || { bri: 100, caps: { bri: true, color: true, ct: true }, rgb: null, kelvin: null };
            if (body.brightness_pct) s.attrs.bri = body.brightness_pct;
            if (body.rgb_color) { s.attrs.rgb = body.rgb_color; s.attrs.kelvin = null; }
            if (body.color_temp_kelvin) { s.attrs.kelvin = body.color_temp_kelvin; s.attrs.rgb = null; }
        }
        if (this.mode === 'demo') {
            return { ok: true, text: t.name + ' eingestellt' };
        }
        const r = await request(this.cfg.url, this.cfg.token, 'POST', '/api/services/light/turn_on', body);
        this.log.info('ha service light.turn_on -> ' + (r.ok ? 'ok' : r.error));
        if (r.ok) await this.poll();
        return { ok: r.ok, text: r.ok ? t.name + ' eingestellt' : r.error };
    }

    /** Every entity of the useful kinds, for the Geraete page: [{ entity, name, domain, state }]. */
    async listAll() {
        if (this.mode === 'demo') return DEMO.concat(DEMO_EXTRA).map((x) => ({ entity: x.entity, name: x.name, domain: x.entity.split('.')[0], state: x.state }));
        if (this.mode !== 'live') return [];
        const r = await request(this.cfg.url, this.cfg.token, 'GET', '/api/states');
        if (!r.ok || !Array.isArray(r.data)) { this.err = r.error || 'Fehler'; return []; }
        return r.data.filter((s) => KINDS.indexOf(String(s.entity_id).split('.')[0]) >= 0)
            .map((s) => ({ entity: s.entity_id, name: String((s.attributes && s.attributes.friendly_name) || s.entity_id.split('.')[1]).slice(0, 22),
                domain: s.entity_id.split('.')[0], state: String(s.state) }))
            .sort((a, b) => (a.domain === b.domain ? a.name.localeCompare(b.name) : KINDS.indexOf(a.domain) - KINDS.indexOf(b.domain)));
    }

    onHome(id) { return this.list.some((e) => e.entity === id); }

    /** Put an entity on the Home page, or take it off. New entries are READ ONLY (no "allow"). Returns { ok, text }. */
    toggleHome(item) {
        const i = this.list.findIndex((e) => e.entity === item.entity);
        if (i >= 0) this.list.splice(i, 1);
        else {
            if (this.list.length >= MAX_TILES) return { ok: false, text: 'Maximal ' + MAX_TILES + ' Eintraege' };
            this.list.push({ entity: item.entity, name: item.name, confirm: false, allow: false });
            this.states[item.entity] = { state: item.state };
        }
        return this.save();
    }

    /** Write the entries back into ha.json, every other field as it is. */
    save() {
        if (this.mode === 'demo') return { ok: true, text: 'Demo: wird nicht gespeichert' };
        try {
            const cur = JSON.parse(fs.readFileSync(this.file, 'utf8'));
            cur.entities = this.list.map((e) => { const o = { entity: e.entity, name: e.name }; if (e.allow) o.allow = true; if (e.confirm) o.confirm = true; return o; });
            atomicWrite(this.file, JSON.stringify(cur, null, 2) + '\n');
            return { ok: true, text: 'Gespeichert' };
        } catch (e) { return { ok: false, text: 'Speichern fehlgeschlagen' }; }
    }

    /** Car data -> automation webhook. Never with demo data unless allowDemoSend. */
    async sendCar(data, isDemo) {
        const c = this.cfg;
        if (!c || !c.webhookId) return this._sent(false, 'Kein webhookId in ha.json');
        if (this.mode === 'demo') { return this._sent(true, 'Demo: nichts gesendet'); }
        if (isDemo && !c.allowDemoSend) return this._sent(false, 'Demo-Fahrt: nicht gesendet');
        const r = await request(c.url, '', 'POST', '/api/webhook/' + encodeURIComponent(c.webhookId), Object.assign({ source: 'mdev_homeassistant' }, data));
        this.log.info('ha webhook -> ' + (r.ok ? 'ok' : r.error));
        return this._sent(r.ok, r.ok ? 'gesendet' : r.error);
    }

    _sent(ok, text) {
        this.sent.ok = ok; this.sent.text = text; this.sent.lastAt = Date.now();
        if (ok) this.sent.count++;
        return this.sent;
    }
}

module.exports = { HA, request };
