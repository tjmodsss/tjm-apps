'use strict';
/**
 * pair.js - phone pairing for the Home Assistant app (GPL-3.0-or-later; built on hexlay's CloudPair, see NOTICE).
 *
 * The car shows a QR code for the phone page  <page>?channel=<CHANNEL>#k=<KEY>. On the phone you type the Home
 * Assistant address and a token; the page encrypts them (AES-256-GCM, key from the #k= fragment, which no server
 * sees) and sends them over the public relay ntfy.sh. The car decrypts, writes ha.json and confirms.
 *
 * What the phone can set: url, token, webhookId. It can NOT switch anything on: "control" and "allow" stay as they are
 * in the file on the car (a new file starts read only, with no entities).
 *
 * Files in the data dir: ha_pair.json { channel, secretKey, [page], [target] }.
 *   page   overrides the phone page address (local tests);  target  the file the config is written to (tests; default ha.json).
 */
const fs = require('fs');
const path = require('path');
const { CloudPair } = require('./cloud_pair');
const qrcodegen = require('./qrcodegen');

const DEFAULT_PAGE = 'https://markoni1408.github.io/mgu-homeassistant/pair.html';

const atomicWrite = (file, text) => {
    const tmp = file + '.tmp-' + process.pid;
    fs.writeFileSync(tmp, text, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, file);
};

class HAPair extends CloudPair {
    constructor(ctx, ha) {
        const dir = ctx.dataDir;
        const file = path.join(dir, 'ha_pair.json');
        const read = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch (e) { return {}; } };
        super(ctx, {
            prefix: 'mgu_ha_', wire: 'ha', title: 'MGU Home Assistant', tag: 'HA CloudPair',
            load: () => { const r = read(); return { channel: r.channel, secretKey: r.secretKey }; },
            save: (channel, secretKey) => { atomicWrite(file, JSON.stringify(Object.assign(read(), { channel, secretKey }), null, 2)); },
        });
        this.ha = ha;
        this.dir = dir;
        this.read = read;
        this.file = file;
        // messages that were already applied: remembered in ha_pair.json, so a message that stays on the public relay
        // for hours is NOT applied again after a restart (a replay would overwrite the configuration)
        const st = read();
        if (Array.isArray(st.seen)) this.fresh.seen = st.seen.filter((x) => typeof x === 'string').slice(-256);
        if (typeof st.lastMsgId === 'string') this.lastMsgId = st.lastMsgId;
        this.last = { at: 0, ok: null, text: '' };
        this.onChange = null;
        this._qr = null;
        this._qrUrl = '';
    }

    since() { return this.lastMsgId || 'all'; }

    /** After every incoming message (applied or not): remember its id and the IVs seen. */
    handleIncomingMessage(rawMsg, replay, ntfyTime) {
        super.handleIncomingMessage(rawMsg, replay, ntfyTime);
        try {
            atomicWrite(this.file, JSON.stringify(Object.assign(this.read(), { lastMsgId: this.lastMsgId, seen: this.fresh.seen.slice(-64) }), null, 2));
        } catch (e) { /* not writable: the in-memory checks still hold */ }
    }

    /** A new channel and key: what was remembered about the old channel no longer applies. */
    reset() {
        super.reset();
        try { atomicWrite(this.file, JSON.stringify(Object.assign(this.read(), { lastMsgId: null, seen: [] }), null, 2)); } catch (e) { /* ignore */ }
    }

    page() { return this.read().page || DEFAULT_PAGE; }

    getPairingUrl() { return this.page() + '?channel=' + this.channel + '#k=' + this.secretKey; }

    isPaired() { return this.ha.mode === 'live'; }

    /** The QR code as horizontal runs of dark modules [{ x, y, w }], and its size in modules. */
    qr() {
        const url = this.getPairingUrl();
        if (this._qr && this._qrUrl === url) return this._qr;
        let out = null;
        try {
            const q = qrcodegen.QrCode.encodeText(url, qrcodegen.QrCode.Ecc.MEDIUM), runs = [];
            for (let y = 0; y < q.size; y++) {
                let x = 0;
                while (x < q.size) {
                    if (!q.getModule(x, y)) { x++; continue; }
                    let w = 1;
                    while (x + w < q.size && q.getModule(x + w, y)) w++;
                    runs.push({ x, y, w });
                    x += w;
                }
            }
            out = { size: q.size, runs };
        } catch (e) { out = null; }
        this._qr = out;
        this._qrUrl = url;
        return out;
    }

    /** A validated message from the phone. */
    handle(msg, replay) {
        if (replay) return;
        if (msg.type === 'hello_request') { this.tellPhone({ type: 'car_hello', app: 'ha', paired: this.isPaired() }); return; }
        if (msg.type !== 'ha_config') return;
        let url = String(msg.url || '').trim().replace(/\/+$/, ''), token = String(msg.token || '').trim(), hook = String(msg.webhookId || '').trim();
        // Home Assistant copies the whole address (https://host/api/webhook/<id>): only the id is wanted
        const wm = /\/api\/webhook\/([A-Za-z0-9_-]+)\/?$/.exec(hook);
        if (wm) hook = wm[1];
        const bad = !/^https?:\/\/[^\s/]+[^\s]*$/.test(url) || url.length > 300 ? 'Adresse ungültig'
            : !/^[^\s]{20,2000}$/.test(token) ? 'Token ungültig' : !/^[A-Za-z0-9_-]{0,200}$/.test(hook) ? 'Webhook-ID ungültig' : '';
        if (bad) { this.last = { at: Date.now(), ok: false, text: bad }; this.tellPhone({ type: 'pair_error', text: bad }); if (this.onChange) this.onChange(); return; }
        const target = path.join(this.dir, this.read().target || 'ha.json');
        let cur = {};
        try { cur = JSON.parse(fs.readFileSync(target, 'utf8')) || {}; } catch (e) { cur = {}; }
        // only these three come from the phone; control / allow / entities stay as they are (new file: read only, empty)
        const next = Object.assign({ control: false, allowDemoSend: false, entities: [] }, cur, { url, token, webhookId: hook || cur.webhookId || '' });   // an empty field keeps the webhook already in the file
        atomicWrite(target, JSON.stringify(next, null, 2) + '\n');
        this.log.info(this.tag + ': configuration received from the phone (' + url.replace(/^(https?:\/\/[^/]+).*$/, '$1') + ')');
        this.last = { at: Date.now(), ok: true, text: 'Zugangsdaten vom Handy erhalten' };
        this.notifyAck();
        if (path.basename(target) === 'ha.json') { this.ha.load(); this.ha.poll().then(() => { if (this.onChange) this.onChange(); }).catch(() => {}); }
        if (this.onChange) this.onChange();
    }
}

module.exports = { HAPair, DEFAULT_PAGE };
