'use strict';
/**
 * Home Assistant for the BMW MGU (iDrive 7): tiles to look at and switch your home, and the car's data sent to
 * Home Assistant. Configuration in <data dir>/ha.json (see ha.js); without it a built-in DEMO runs.
 * Read only until ha.json says "control": true. The token is never logged or drawn.
 */
const mgu = require('./kit/mgu');
const G = require('./kit/gauges');
const Car = require('./kit/car');
const { Canvas } = require('./kit/canvas');
const UI = require('./ui');
const { HA } = require('./ha');
const { HAPair } = require('./pair');

const PAGES = ['Home', 'Geraete', 'Auto an HA', 'Status', 'Verbinden'];
const FILTERS = [['Alle', null], ['Licht', ['light']], ['Schalter', ['switch', 'input_boolean', 'fan']], ['Szenen', ['scene', 'script', 'button']],
    ['Sensoren', ['sensor', 'binary_sensor']], ['Weitere', ['cover', 'lock', 'climate']]];
const DOMAIN_LABEL = { light: 'Licht', switch: 'Schalter', input_boolean: 'Schalter', fan: 'Ventilator', scene: 'Szene', script: 'Skript', button: 'Taste',
    cover: 'Rollo/Tor', lock: 'Schloss', sensor: 'Sensor', binary_sensor: 'Sensor', climate: 'Klima' };
const STATE_WORD = { on: 'AN', off: 'AUS', locked: 'verriegelt', unlocked: 'offen', open: 'offen', closed: 'zu', scening: '-', unavailable: 'nicht verfuegbar' };
const POLL_MS = 5000;
const ARM_MS = 4000;

const ago = (t) => { if (!t) return '—'; const s = Math.round((Date.now() - t) / 1000); return s < 60 ? 'vor ' + s + ' s' : 'vor ' + Math.round(s / 60) + ' min'; };

mgu.run({
    async start(ctx) {
        const { ui, settings, log } = ctx;
        const ha = new HA(ctx.dataDir, log);
        const car = new Car(ctx, ['rpm', 'speed', 'temps', 'gear']);
        const pair = new HAPair(ctx, ha);
        let pageIdx = 0, tilePage = 0, tuneLight = -1, armed = { i: -1, at: 0 }, note = { text: '', bad: false, at: 0 }, loop = null;
        const repaint = () => (loop && loop.kick ? loop.kick() : render());
        pair.onChange = repaint;
        // the pairing channel is only listened to while the Verbinden page is open (saves data in the car)
        const syncPair = () => {
            if (PAGES[pageIdx] === 'Verbinden') pair.startPolling(); else pair.stopPolling();
            if (PAGES[pageIdx] === 'Geraete') loadDevices();
        };
        // the Geraete page: every entity of Home Assistant, filtered, 8 per page; a tap puts it on Home or takes it off
        const dev = { all: [], filter: 0, page: 0, loading: false, error: '', note: '', noteBad: false };
        const devItems = () => { const f = FILTERS[dev.filter][1]; return dev.all.filter((e) => !f || f.indexOf(e.domain) >= 0); };
        const loadDevices = () => {
            if (dev.loading) return Promise.resolve();
            dev.loading = true; dev.error = ''; repaint();
            return ha.listAll().then((l) => { dev.all = l; if (!l.length) dev.error = ha.mode === 'live' ? (ha.err || 'Keine Geraete gefunden') : 'Noch nicht verbunden (Tab Verbinden)'; })
                .catch((e) => { log.error('devices', e); dev.error = 'Fehler beim Laden'; })
                .then(() => { dev.loading = false; repaint(); });
        };
        const say = (text, bad) => { note = { text, bad: !!bad, at: Date.now() }; repaint(); };

        const act = {
            tile(i) {
                const t = ha.tiles()[i];
                if (!t) return null;
                if (!t.canAct) { say(t.why === 'nur lesen' ? 'Nur-Lesen-Modus: es wird nichts geschaltet' : t.name + ': nicht freigegeben', true); return null; }
                if (t.needsConfirm && !(armed.i === i && Date.now() - armed.at < ARM_MS)) {
                    armed = { i, at: Date.now() };
                    setTimeout(repaint, ARM_MS + 50);
                    repaint();
                    return null;
                }
                armed = { i: -1, at: 0 };
                return ha.press(i).then((r) => say(r.text, !r.ok)).catch((e) => { log.error('press', e); say('Fehler beim Schalten', true); });
            },
            tune(i) {
                const t = ha.tiles()[i];
                if (!t || !t.tune) return;
                tuneLight = i;
                repaint();
            },
            closeTune() {
                tuneLight = -1;
                repaint();
            },
            setLight(i, d) {
                const t = ha.tiles()[i];
                if (!t || !t.canAct) return null;
                return ha.light(i, d).then((r) => { say(r.text, !r.ok); repaint(); }).catch((e) => { log.error('light', e); say('Fehler beim Einstellen', true); });
            },
            pager() { tuneLight = -1; const n = Math.max(1, Math.ceil(ha.list.length / 8)); tilePage = (tilePage + 1) % n; repaint(); },
            reload() { tuneLight = -1; ha.load(); tilePage = 0; say('Konfiguration neu geladen'); return ha.poll().then(repaint).catch((e) => log.error('poll', e)); },
            toggleSend() { settings.set('sendToHA', !settings.get('sendToHA')); repaint(); },
            devFilter(i) { dev.filter = i; dev.page = 0; repaint(); },
            devPager() { dev.page = (dev.page + 1) % Math.max(1, Math.ceil(devItems().length / 8)); repaint(); },
            devRefresh() { return loadDevices(); },
            devToggle(k) {
                const it = devItems()[dev.page * 8 + k];
                if (!it) return null;
                const r = ha.toggleHome(it);
                dev.note = r.ok ? it.name + (ha.onHome(it.entity) ? ': auf Home gesetzt (nur lesend)' : ': von Home entfernt') : r.text; dev.noteBad = !r.ok;
                repaint();
                if (r.ok) ha.poll().then(repaint).catch(() => {});
                return null;
            },
            resetPair() { pair.reset(); pair.startPolling(); pair.last = { at: 0, ok: null, text: '' }; repaint(); },
        };

        const statusLine = () => {
            if (note.text && Date.now() - note.at < 5000) return { text: note.text, bad: note.bad };
            if (ha.mode === 'demo') return { text: 'Demo-Daten · ha.json fehlt, es wird nichts übertragen', bad: false };
            if (ha.mode === 'error') return { text: ha.err, bad: true };
            if (ha.reachable === null) return { text: 'Verbinde mit ' + ha.host() + ' …', bad: false };
            if (!ha.reachable) return { text: ha.err || 'Nicht erreichbar', bad: true };
            return { text: ha.host() + ' · ' + ha.list.length + ' Einträge · ' + ago(ha.lastPoll) + (ha.err ? ' · ' + ha.err : ''), bad: !!ha.err };
        };

        const render = async () => {
            const tiles = ha.tiles();
            const d = car.data();
            const every = Number(settings.get('sendEvery')) || 30;
            const s = statusLine();
            const mask = ha.cfg && ha.cfg.webhookId ? (ha.mode === 'demo' ? 'Demo' : ha.host() + '/api/webhook/' + ha.cfg.webhookId.slice(0, 4) + '…') : '';
            const v = {
                page: PAGES[pageIdx], pages: PAGES, pageIdx, mode: ha.mode,
                readOnly: !(ha.cfg && ha.cfg.control),
                tiles, tilePage, tilePages: Math.max(1, Math.ceil(tiles.length / 8)), armed: armed.i >= 0 && Date.now() - armed.at < ARM_MS ? armed.i : -1,
                tuneLight: PAGES[pageIdx] === 'Home' && tuneLight >= 0 ? tuneLight : null,
                statusLine: s.text, statusBad: s.bad,
                car: { speed: d.speed, rpm: d.rpm, oil: d.oil, coolant: d.coolant, gear: d.gear, demo: !!d.demo },
                dev: { filters: FILTERS.map((f) => f[0]), filter: dev.filter, loading: dev.loading, error: dev.error, note: dev.note, noteBad: dev.noteBad,
                    page: dev.page, pages: Math.max(1, Math.ceil(devItems().length / 8)), onHomeCount: ha.list.length,
                    items: devItems().slice(dev.page * 8, dev.page * 8 + 8).map((e) => ({ name: e.name, onHome: ha.onHome(e.entity), domainLabel: DOMAIN_LABEL[e.domain] || e.domain,
                        stateText: (e.domain === 'sensor' || e.domain === 'binary_sensor' ? e.state : (STATE_WORD[e.state] || e.state)) })) },
                pair: { qr: PAGES[pageIdx] === 'Verbinden' ? pair.qr() : null, code: pair.getShortCode(), paired: pair.isPaired(), last: pair.last, ago: ago(pair.last.at),
                    reachable: ha.reachable, host: ha.host(), entities: ha.list.length, poll: ago(ha.lastPoll), err: ha.err, page: pair.page().replace(/^https?:\/\//, '').replace(/\?.*$/, '') },
                send: { on: !!settings.get('sendToHA'), every, target: mask, last: ago(ha.sent.lastAt), ok: ha.sent.ok, text: ha.sent.text, count: ha.sent.count },
                info: { mode: ha.mode === 'demo' ? 'Demo (keine ha.json)' : ha.mode === 'live' ? (ha.cfg.control ? 'Live, Steuerung AN' : 'Live, nur lesen') : 'Konfigurationsfehler',
                    host: ha.host(), reachable: ha.mode !== 'live' ? '—' : ha.reachable === null ? 'wird geprüft' : ha.reachable ? 'ja' : 'nein',
                    entities: ha.list.length, poll: ha.mode === 'live' ? ago(ha.lastPoll) : '', error: ha.mode === 'live' ? ha.err : '' },
            };
            const t = ctx.theme();
            const cv = ctx.canvas(UI.W, UI.H) || new Canvas(UI.W, UI.H);
            UI.draw(cv, G, t, v, act);
            await ui.image('MAIN_GFX', cv);
        };

        ['BTN_PAGE', 'BTN_RELOAD'].forEach((b) => ctx.hideButton && ctx.hideButton(b));
        ui.onClick('BTN_PAGE', () => { tuneLight = -1; pageIdx = (pageIdx + 1) % PAGES.length; syncPair(); return render(); });
        ui.onClick('BTN_RELOAD', act.reload);
        ctx.onTab((i) => { tuneLight = -1; if (PAGES[i]) pageIdx = i; syncPair(); return render(); });

        // ask Home Assistant now and then; send the car's data on the interval (only when switched on)
        const poll = () => ha.poll().then(repaint).catch((e) => log.error('poll', e));
        setInterval(poll, POLL_MS);
        let lastSend = 0;
        setInterval(() => {
            if (!settings.get('sendToHA')) return;
            const every = (Number(settings.get('sendEvery')) || 30) * 1000;
            if (Date.now() - lastSend < every) return;
            lastSend = Date.now();
            const d = car.data();
            ha.sendCar({ speed: d.speed, rpm: d.rpm, oil: d.oil, coolant: d.coolant, gear: d.gear, demo: !!d.demo }, !!d.demo).then(repaint).catch((e) => log.error('send', e));
        }, 1000);

        loop = ctx.loop('MAIN', 8, render);
        poll();
        log.info('mdev_homeassistant ready (mode=' + ha.mode + ', entities=' + ha.list.length + ')');
    },
});
