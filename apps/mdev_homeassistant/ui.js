'use strict';
/**
 * ui.js - the Home Assistant screens, a PURE draw(cv, G, t, v, act) (renders on the car and in the PC emulator).
 *
 *   Home        tiles: lights, switches, scenes, scripts, sensors, lock / garage door (guarded)
 *   Auto an HA  the car's data and the "send to Home Assistant" switch
 *   Status      connection, mode, the safety rules
 *
 * v = { page, pages, pageIdx, mode ('demo' | 'live' | 'error'), readOnly, tiles[], tilePage, tilePages, armed (tile index or -1),
 *       statusLine, statusBad, car{}, send{}, info{} }     act = { tile(i), pager(), reload(), toggleSend() }
 */
const W = 1600;
const L = { literal: true };
const TR = { 'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'Ä': 'Ae', 'Ö': 'Oe', 'Ü': 'Ue', 'ß': 'ss' };
// the kit fonts have no umlauts (113 glyphs): write them out
const de = (x) => String(x).replace(/[äöüÄÖÜß]/g, (c) => TR[c]);
const txt = (c, str, x, y, size, col, o) => c.text(de(str), x, y, size, col, o);
const tww = (c, str, size, o) => c.textWidth(de(str), size, o);

const ON = ['on', 'unlocked', 'open', 'heat', 'cool', 'playing', 'home'];
const isOn = (tl) => ON.indexOf(tl.state) >= 0;

function stateText(tl) {
    if (!tl.available) return 'nicht verfügbar';
    if (tl.domain === 'sensor' || tl.domain === 'binary_sensor' || tl.domain === 'climate') return tl.state + (tl.unit ? ' ' + tl.unit : '');
    const m = { on: 'AN', off: 'AUS', locked: 'verriegelt', unlocked: 'offen', open: 'offen', closed: 'zu', scening: 'Szene' };
    return m[tl.state] || tl.state;
}

/* ---- little icons from lines and circles ---- */
function icon(cv, G, t, tl, cx, cy, on) {
    let c = on ? (tl.domain === 'light' ? '#f5b942' : '#4aa3ff') : G.withAlpha('#ffffff', 0.55), dim = G.withAlpha('#ffffff', 0.18);
    const d = tl.domain;
    if (d === 'light') {
        if (on && tl.light && Array.isArray(tl.light.rgb) && tl.light.rgb.length === 3) {
            const [r, g, b] = tl.light.rgb;
            c = '#' + [r, g, b].map((x) => Math.min(255, Math.max(0, Math.round(Number(x) || 0))).toString(16).padStart(2, '0')).join('');
        }
        if (on) cv.circle(cx, cy - 2, 15, c); else cv.arc(cx, cy - 2, 12, 15, 0, 360, c);
        cv.fillRect(cx - 7, cy + 15, 14, 5, c);
        for (let i = 0; i < 8; i++) {
            const a = i * Math.PI / 4, r0 = 22, r1 = 30;
            if (on) cv.line(cx + Math.sin(a) * r0, cy - 2 - Math.cos(a) * r0, cx + Math.sin(a) * r1, cy - 2 - Math.cos(a) * r1, 3, c);
        }
    } else if (d === 'switch' || d === 'input_boolean' || d === 'fan') {
        cv.roundRect(cx - 30, cy - 15, 60, 30, 15, on ? c : dim);
        cv.circle(cx + (on ? 15 : -15), cy, 11, on ? '#ffffff' : G.withAlpha('#ffffff', 0.7));
    } else if (d === 'scene' || d === 'script' || d === 'button') {
        cv.circle(cx, cy, 26, dim);
        cv.quad([[cx - 8, cy - 14], [cx - 8, cy + 14], [cx + 15, cy], [cx + 3.5, cy - 7]], c);   // a triangle: the 4th point sits on an edge
    } else if (d === 'lock') {
        cv.strokeRoundRect(cx - 13, cy - 28, 26, 24, 12, 4, c);
        cv.roundRect(cx - 20, cy - 8, 40, 32, 6, c);
        cv.circle(cx, cy + 6, 4, G.withAlpha('#000000', 0.6));
    } else if (d === 'cover') {
        cv.roundRect(cx - 28, cy - 20, 56, 44, 5, dim);
        for (let i = 0; i < 4; i++) cv.fillRect(cx - 24, cy - 14 + i * 10, 48, 4, on ? G.withAlpha(c, 0.35) : c);
    } else {
        cv.arc(cx, cy, 20, 25, 0, 360, c);
        cv.fillRect(cx - 2, cy - 14, 4, 16, c);
        cv.circle(cx, cy + 6, 4, c);
    }
}

function tile(cv, G, t, x, y, w, h, tl, i, v, act) {
    const on = isOn(tl), armed = v.armed === i;
    const accent = tl.domain === 'light' ? '#f5b942' : '#4aa3ff';   // warm for lights, blue for the rest (red is for warnings)
    cv.roundRect(x, y, w, h, 20, on ? G.withAlpha(accent, 0.26) : G.withAlpha('#ffffff', 0.07));
    cv.strokeRoundRect(x, y, w, h, 20, armed ? 3 : 2, armed ? (t.crit || '#ef2b2d') : on ? accent : G.withAlpha('#ffffff', 0.16));
    txt(cv, tl.name, x + 24, y + 46, 30, t.text, { font: 'bold', literal: true });
    const dimmed = !tl.available;
    let stText = armed ? 'Nochmal tippen' : stateText(tl);
    if (!armed && on && tl.domain === 'light' && tl.light && typeof tl.light.bri === 'number') {
        stText = 'AN · ' + tl.light.bri + ' %';
    }
    txt(cv, stText, x + 24, y + h - 26, 27, armed ? (t.crit || '#ef2b2d') : dimmed ? t.dim : on ? t.text : t.dim, L);
    icon(cv, G, t, tl, x + w - 64, y + h / 2 + 2, on);
    if (tl.why && tl.why !== 'nur lesen') {
        const tw = tww(cv, tl.why, 18, L) + 22;
        cv.roundRect(x + w - tw - 14, y + 12, tw, 28, 14, G.withAlpha('#ffffff', 0.12));
        txt(cv, tl.why, x + w - 14 - tw / 2, y + 32, 18, t.dim, { align: 'center', literal: true });
    } else if (tl.needsConfirm && tl.canAct) {
        txt(cv, 'geschützt', x + w - 20, y + 32, 18, t.warn || '#d29922', { align: 'right', literal: true });
    } else if (tl.tune && act && act.tune) {
        const hasColor = tl.light && tl.light.caps && tl.light.caps.color;
        const lbl = hasColor ? 'Farbe' : 'Dimmen';
        const bw = 82, bh = 34, bx = x + w - bw - 14, by = y + 12;
        cv.roundRect(bx, by, bw, bh, 17, G.withAlpha('#ffffff', 0.14));
        cv.strokeRoundRect(bx, by, bw, bh, 17, 1.5, G.withAlpha('#ffffff', 0.3));
        txt(cv, lbl, bx + bw / 2, by + 23, 19, t.text, { align: 'center', font: 'bold', literal: true });
        if (cv.own && cv.target && v.tuneLight == null) cv.target(bx, by, bw, bh, () => act.tune(i), 'tune' + i);
    }
    if (cv.own && cv.target && act && act.tile && tl.available !== undefined && v.tuneLight == null) cv.target(x, y, w, h, () => act.tile(i), 'tile' + i);
}

const PRESET_COLORS = [
    { name: 'Rot', rgb: [255, 59, 48], hex: '#ff3b30' },
    { name: 'Orange', rgb: [255, 149, 0], hex: '#ff9500' },
    { name: 'Gelb', rgb: [255, 204, 0], hex: '#ffcc00' },
    { name: 'Gruen', rgb: [52, 199, 89], hex: '#34c759' },
    { name: 'Tuerkis', rgb: [0, 199, 190], hex: '#00c7be' },
    { name: 'Blau', rgb: [0, 122, 255], hex: '#007aff' },
    { name: 'Lila', rgb: [175, 82, 222], hex: '#af52de' },
    { name: 'Pink', rgb: [255, 45, 85], hex: '#ff2d55' },
];

const KELVIN_PRESETS = [
    { label: 'Warmweiss (2700 K)', k: 2700, col: '#ffb366' },
    { label: 'Neutralweiss (4000 K)', k: 4000, col: '#fff1e0' },
    { label: 'Kaltweiss (6000 K)', k: 6000, col: '#dbe9ff' },
];

const BRI_STEPS = [
    { label: '-10%', delta: -10 },
    { label: '10%', val: 10 },
    { label: '25%', val: 25 },
    { label: '50%', val: 50 },
    { label: '75%', val: 75 },
    { label: '100%', val: 100 },
    { label: '+10%', delta: 10 },
];

function drawLightModal(cv, G, t, v, act, tl, tileIdx) {
    const on = isOn(tl);
    const mx = 120, my = 42, mw = 1360, mh = 444;

    // Dark backdrop over home tiles
    cv.fillRect(0, 0, W, 520, G.withAlpha('#000000', 0.78));

    // Card background
    cv.roundRect(mx, my, mw, mh, 20, '#16191f');
    cv.strokeRoundRect(mx, my, mw, mh, 20, 2, G.withAlpha('#ffffff', 0.22));

    // Header
    icon(cv, G, t, tl, mx + 50, my + 44, on);
    txt(cv, tl.name, mx + 96, my + 42, 30, t.text, { font: 'bold', literal: true });
    let sub = on ? 'Eingeschaltet' : 'Ausgeschaltet';
    if (on && tl.light && typeof tl.light.bri === 'number') sub += '  ·  ' + tl.light.bri + ' % Helligkeit';
    if (on && tl.light && tl.light.kelvin) sub += '  ·  ' + tl.light.kelvin + ' K';
    txt(cv, sub, mx + 96, my + 68, 20, on ? '#f5b942' : t.dim, L);

    // Toggle button in header
    const togW = 160, togH = 42, togX = mx + mw - 300, togY = my + 24;
    cv.roundRect(togX, togY, togW, togH, 21, on ? G.withAlpha('#ef2b2d', 0.25) : G.withAlpha('#3fb950', 0.25));
    cv.strokeRoundRect(togX, togY, togW, togH, 21, 1.5, on ? '#ef2b2d' : '#3fb950');
    txt(cv, on ? 'Ausschalten' : 'Einschalten', togX + togW / 2, togY + 27, 20, '#ffffff', { align: 'center', font: 'bold', literal: true });
    if (cv.own && cv.target) cv.target(togX, togY, togW, togH, () => act.tile(tileIdx), 'tuneToggle');

    // Close button in header
    const clsW = 110, clsH = 42, clsX = mx + mw - 126, clsY = my + 24;
    cv.roundRect(clsX, clsY, clsW, clsH, 21, t.accent || '#4aa3ff');
    txt(cv, 'Fertig', clsX + clsW / 2, clsY + 27, 20, '#ffffff', { align: 'center', font: 'bold', literal: true });
    if (cv.own && cv.target) cv.target(clsX, clsY, clsW, clsH, act.closeTune, 'tuneClose');

    // Divider
    cv.fillRect(mx + 30, my + 82, mw - 60, 1, G.withAlpha('#ffffff', 0.12));

    let curY = my + 98;
    const caps = (tl.light && tl.light.caps) || { bri: true, color: false, ct: false };

    // Section 1: Helligkeit
    if (caps.bri) {
        txt(cv, 'HELLIGKEIT' + (tl.light && tl.light.bri != null ? ' (' + tl.light.bri + ' %)' : ''), mx + 40, curY + 16, 20, t.dim, { font: 'bold', spacing: 1.5, literal: true });
        const bw = 140, bh = 46, bgap = 16, bx0 = mx + 40;
        BRI_STEPS.forEach((step, k) => {
            const bx = bx0 + k * (bw + bgap);
            const isSel = step.val != null && tl.light && tl.light.bri != null && Math.abs(tl.light.bri - step.val) <= 6;
            cv.roundRect(bx, curY + 28, bw, bh, 23, isSel ? G.withAlpha('#f5b942', 0.35) : G.withAlpha('#ffffff', 0.08));
            cv.strokeRoundRect(bx, curY + 28, bw, bh, 23, isSel ? 2 : 1.5, isSel ? '#f5b942' : G.withAlpha('#ffffff', 0.2));
            txt(cv, step.label, bx + bw / 2, curY + 28 + 29, 21, isSel ? '#ffffff' : t.text, { align: 'center', font: 'bold', literal: true });
            const targetBri = step.val != null ? step.val : Math.min(100, Math.max(1, (tl.light && tl.light.bri ? tl.light.bri : 50) + step.delta));
            if (cv.own && cv.target) cv.target(bx, curY + 28, bw, bh, () => act.setLight(tileIdx, { bri: targetBri }), 'tuneBri' + k);
        });
        curY += 92;
    }

    // Section 2: Weisstoene (Kelvin)
    if (caps.ct) {
        txt(cv, 'WEISSTON' + (tl.light && tl.light.kelvin ? ' (' + tl.light.kelvin + ' K)' : ''), mx + 40, curY + 16, 20, t.dim, { font: 'bold', spacing: 1.5, literal: true });
        const kw = 340, kh = 44, kgap = 20, kx0 = mx + 40;
        KELVIN_PRESETS.forEach((item, k) => {
            const kx = kx0 + k * (kw + kgap);
            const isSel = tl.light && tl.light.kelvin != null && Math.abs(tl.light.kelvin - item.k) <= 400;
            cv.roundRect(kx, curY + 28, kw, kh, 22, isSel ? G.withAlpha(item.col, 0.32) : G.withAlpha('#ffffff', 0.08));
            cv.strokeRoundRect(kx, curY + 28, kw, kh, 22, isSel ? 2 : 1.5, isSel ? item.col : G.withAlpha('#ffffff', 0.2));
            cv.circle(kx + 26, curY + 28 + kh / 2, 10, item.col);
            txt(cv, item.label, kx + 48, curY + 28 + 29, 21, isSel ? '#ffffff' : t.text, { font: 'bold', literal: true });
            if (cv.own && cv.target) cv.target(kx, curY + 28, kw, kh, () => act.setLight(tileIdx, { kelvin: item.k }), 'tuneK' + k);
        });
        curY += 88;
    }

    // Section 3: Farben (RGB)
    if (caps.color) {
        txt(cv, 'FARBE', mx + 40, curY + 16, 20, t.dim, { font: 'bold', spacing: 1.5, literal: true });
        const cw = 140, ch = 44, cgap = 14, cx0 = mx + 40;
        PRESET_COLORS.forEach((c, k) => {
            const cx = cx0 + k * (cw + cgap);
            const cy = curY + 28;
            const rgb = tl.light && tl.light.rgb;
            const isSel = Array.isArray(rgb) && rgb.length === 3 && Math.abs(rgb[0] - c.rgb[0]) < 35 && Math.abs(rgb[1] - c.rgb[1]) < 35 && Math.abs(rgb[2] - c.rgb[2]) < 35;
            cv.roundRect(cx, cy, cw, ch, 22, isSel ? G.withAlpha(c.hex, 0.38) : G.withAlpha('#ffffff', 0.08));
            cv.strokeRoundRect(cx, cy, cw, ch, 22, isSel ? 2 : 1.5, isSel ? c.hex : G.withAlpha('#ffffff', 0.2));
            cv.circle(cx + 22, cy + ch / 2, 11, c.hex);
            txt(cv, c.name, cx + 42, cy + 29, 20, isSel ? '#ffffff' : t.text, { font: 'bold', literal: true });
            if (cv.own && cv.target) cv.target(cx, cy, cw, ch, () => act.setLight(tileIdx, { rgb: c.rgb }), 'tuneCol' + k);
        });
    }

    // Backdrop click outside modal closes it
    if (cv.own && cv.target) cv.target(0, 0, W, 520, act.closeTune, 'tuneBackdrop');
}

function drawHome(cv, G, t, v, act, bottom) {
    const x0 = 52, y0 = G.TOP + 22, cols = 4, gap = 18, inner = W - 104;
    const tw = (inner - gap * (cols - 1)) / cols;
    const areaH = bottom - y0 - 82, th = (areaH - gap) / 2;
    const per = cols * 2, first = v.tilePage * per;
    if (!v.tiles.length) {
        txt(cv, v.mode === 'error' ? 'Konfiguration prüfen' : 'Keine Einträge', W / 2, y0 + 110, 36, t.text, { align: 'center', font: 'bold', literal: true });
        txt(cv, v.mode === 'error' ? v.statusLine : 'Im Tab "Geraete" Geraete auswaehlen.', W / 2, y0 + 160, 26, t.dim, { align: 'center', literal: true });
    }
    for (let k = 0; k < per; k++) {
        const tl = v.tiles[first + k];
        if (!tl) break;
        tile(cv, G, t, x0 + (k % cols) * (tw + gap), y0 + Math.floor(k / cols) * (th + gap), tw, th, tl, first + k, v, act);
    }
    // bottom row: pager, status line, reload
    const by = bottom - 62;
    let bx = x0;
    if (v.tilePages > 1) bx += G.button(cv, t, bx, by, 0, 52, 'Seite ' + (v.tilePage + 1) + '/' + v.tilePages, v.tuneLight != null ? null : act.pager, { key: 'pager' }) + 22;
    txt(cv, v.statusLine, bx, by + 36, 26, v.statusBad ? (t.crit || '#ef2b2d') : t.dim, L);
    const rw = tww(cv, 'NEU LADEN', 21, { font: 'bold', spacing: 1.5 }) + 62;
    G.button(cv, t, W - 52 - rw, by, rw, 52, 'Neu laden', v.tuneLight != null ? null : act.reload, { key: 'reload' });

    if (v.tuneLight != null && v.tiles[v.tuneLight]) {
        drawLightModal(cv, G, t, v, act, v.tiles[v.tuneLight], v.tuneLight);
    }
}

function line(cv, G, t, x, y, w, label, value, hot) {
    txt(cv, label, x, y, 26, t.dim, L);
    txt(cv, value, x + w, y, 30, hot ? (t.accent2 || '#81c4ff') : t.text, { align: 'right', font: 'bold', literal: true });
    cv.fillRect(x, y + 14, w, 1, G.withAlpha('#ffffff', 0.1));
}

function drawCar(cv, G, t, v, act, bottom) {
    const c = v.car || {}, s = v.send || {}, f = (n, d) => (Number.isFinite(n) ? n.toFixed(d || 0) : '—');
    const x0 = 64, y0 = G.TOP + 56, w = 640;
    txt(cv, 'Fahrzeugdaten', x0, G.TOP + 40, 24, t.dim, { font: 'bold', spacing: 2, literal: true });
    line(cv, G, t, x0, y0 + 30, w, 'Geschwindigkeit', f(c.speed) + ' km/h');
    line(cv, G, t, x0, y0 + 90, w, 'Drehzahl', f(c.rpm) + ' U/min');
    line(cv, G, t, x0, y0 + 150, w, 'Öltemperatur', f(c.oil) + ' °C');
    line(cv, G, t, x0, y0 + 210, w, 'Kühlwasser', f(c.coolant) + ' °C');
    line(cv, G, t, x0, y0 + 270, w, 'Gang', c.gear === undefined || c.gear === null ? '—' : String(c.gear < 0 ? 'R' : c.gear === 0 ? 'N/P' : c.gear));
    if (c.demo) txt(cv, 'Demo-Fahrt: simulierte Werte', x0, y0 + 330, 22, t.warn || '#d29922', L);

    const x1 = 790, w1 = 740;
    txt(cv, 'An Home Assistant senden', x1, G.TOP + 40, 24, t.dim, { font: 'bold', spacing: 2, literal: true });
    G.button(cv, t, x1, y0 + 6, 300, 64, s.on ? 'Senden: AN' : 'Senden: AUS', act.toggleSend, { key: 'send', primary: !!s.on });
    txt(cv, 'alle ' + s.every + ' s', x1 + 326, y0 + 48, 28, t.text, L);
    line(cv, G, t, x1, y0 + 120, w1, 'Ziel', s.target || 'nicht eingerichtet');
    line(cv, G, t, x1, y0 + 180, w1, 'Letzter Versand', s.last || '—');
    line(cv, G, t, x1, y0 + 240, w1, 'Ergebnis', s.text || '—', s.ok === true);
    line(cv, G, t, x1, y0 + 300, w1, 'Gesendet', String(s.count || 0) + ' Mal');
    txt(cv, 'In Home Assistant: Automation mit Auslöser "Webhook" und der webhookId aus ha.json.', x1, y0 + 350, 20, t.dim, L);
}

function drawStatus(cv, G, t, v) {
    const i = v.info || {}, x0 = 64, w = 1470, y0 = G.TOP + 100;
    txt(cv, 'Verbindung', x0, G.TOP + 40, 24, t.dim, { font: 'bold', spacing: 2, literal: true });
    line(cv, G, t, x0, y0, w, 'Modus', i.mode);
    line(cv, G, t, x0, y0 + 56, w, 'Home Assistant', i.host || '—');
    line(cv, G, t, x0, y0 + 112, w, 'Erreichbar', i.reachable);
    line(cv, G, t, x0, y0 + 168, w, 'Einträge', String(i.entities));
    line(cv, G, t, x0, y0 + 224, w, 'Letzte Abfrage', i.poll || '—');
    if (i.error) txt(cv, i.error, x0, y0 + 270, 26, t.crit || '#ef2b2d', L);
    txt(cv, 'Schutz: ohne "control": true wird nichts geschaltet. Schloss, Garagentor und Alarm nur mit "confirm": true und zweitem Tippen.', x0, y0 + 316, 22, t.dim, L);
}

function drawPair(cv, G, t, v, act, bottom) {
    const p = v.pair || {}, x0 = 64, y0 = G.TOP + 34, S = 360, card = S + 40;
    cv.roundRect(x0, y0, card, card, 18, '#ffffff');
    if (p.qr) {
        const m = Math.max(1, Math.floor(S / p.qr.size)), off = Math.floor((card - m * p.qr.size) / 2);
        p.qr.runs.forEach((r) => cv.fillRect(x0 + off + r.x * m, y0 + off + r.y * m, r.w * m, m, '#000000'));
    } else if (v.page === 'Verbinden') txt(cv, 'QR-Code nicht verfügbar', x0 + card / 2, y0 + card / 2, 24, '#555555', { align: 'center', literal: true });
    const x1 = x0 + card + 50;
    txt(cv, 'Mit dem Handy verbinden', x1, G.TOP + 40, 24, t.dim, { font: 'bold', spacing: 2, literal: true });
    txt(cv, '1   QR-Code mit der Handy-Kamera scannen', x1, y0 + 62, 30, t.text, { font: 'bold', literal: true });
    txt(cv, '2   Adresse und Token von Home Assistant eingeben', x1, y0 + 118, 30, t.text, { font: 'bold', literal: true });
    txt(cv, '3   Senden. Das Auto uebernimmt die Daten', x1, y0 + 174, 30, t.text, { font: 'bold', literal: true });
    txt(cv, 'Seite auf dem Handy: ' + (p.page || ''), x1, y0 + 226, 22, t.dim, L);
    txt(cv, 'Code ' + (p.code || ''), x1, y0 + 262, 22, t.dim, L);
    // connection state: waiting / phone sent data and Home Assistant is being checked / connected / not reachable / rejected
    const last = p.last || {}, OK = '#3fb950', BAD = t.crit || '#ef2b2d';
    let col = t.dim, head = 'Warte auf das Handy ...', detail = 'Nach dem Scannen erscheint hier der Status.';
    if (last.ok === false) { col = BAD; head = 'Fehler: ' + last.text; detail = 'Auf dem Handy die Eingaben pruefen und erneut senden. (' + p.ago + ')'; }
    else if (p.paired && p.reachable === true) {
        col = OK; head = 'Verbunden. Home Assistant erreichbar';
        detail = (p.host || '') + '  ·  ' + p.entities + ' Eintraege  ·  Abfrage ' + p.poll + (last.ok === true ? '  ·  Daten vom Handy ' + p.ago : '');
    } else if (p.paired && p.reachable === false) {
        col = BAD; head = 'Handy verbunden, aber Home Assistant nicht erreichbar';
        detail = (p.err || 'Keine Antwort von ' + (p.host || 'Home Assistant')) + (last.ok === true ? '  ·  Daten vom Handy ' + p.ago : '');
    } else if (p.paired) { col = t.accent2 || '#4aa3ff'; head = (last.ok === true ? 'Handy verbunden. ' : '') + 'Pruefe Home Assistant ...'; detail = p.host || ''; }
    cv.roundRect(x1, y0 + 290, 22, 22, 11, col);
    txt(cv, head, x1 + 38, y0 + 312, 28, col, { font: 'bold', literal: true });
    txt(cv, detail, x1 + 38, y0 + 348, 22, t.dim, L);
    txt(cv, 'Handy setzt nur Adresse, Token, Webhook.', x0, y0 + card + 26, 20, t.dim, L);
    G.button(cv, t, x1, bottom - 62, 0, 52, 'Neu koppeln', act.resetPair, { key: 'resetpair', confirm: true });
}

function drawDevices(cv, G, t, v, act, bottom) {
    const dv = v.dev || {}, x0 = 52, inner = W - 104, cols = 4, gap = 18;
    let fx = x0;
    (dv.filters || []).forEach((name, i) => { fx += G.button(cv, t, fx, G.TOP + 14, 0, 44, name, () => act.devFilter(i), { key: 'flt' + i, primary: i === dv.filter }) + 12; });
    const y0 = G.TOP + 74, areaH = bottom - y0 - 82, th = (areaH - gap) / 2, tw = (inner - gap * (cols - 1)) / cols;
    if (dv.loading) txt(cv, 'Lade Geraete ...', W / 2, y0 + 110, 32, t.dim, { align: 'center', literal: true });
    else if (!dv.items || !dv.items.length) txt(cv, dv.error || 'Keine Geraete in dieser Gruppe', W / 2, y0 + 110, 30, dv.error ? (t.crit || '#ef2b2d') : t.dim, { align: 'center', literal: true });
    (dv.items || []).forEach((it, k) => {
        const x = x0 + (k % cols) * (tw + gap), y = y0 + Math.floor(k / cols) * (th + gap), on = it.onHome;
        cv.roundRect(x, y, tw, th, 20, on ? G.withAlpha('#4aa3ff', 0.22) : G.withAlpha('#ffffff', 0.07));
        cv.strokeRoundRect(x, y, tw, th, 20, 2, on ? '#4aa3ff' : G.withAlpha('#ffffff', 0.16));
        txt(cv, it.name, x + 22, y + 42, 28, t.text, { font: 'bold', literal: true });
        txt(cv, it.domainLabel + ' · ' + it.stateText, x + 22, y + th - 56, 22, t.dim, L);
        txt(cv, on ? 'auf Home  (tippen = entfernen)' : 'tippen = auf Home', x + 22, y + th - 20, 22, on ? '#4aa3ff' : t.dim, L);
        if (cv.own && cv.target) cv.target(x, y, tw, th, () => act.devToggle(k), 'dev' + k);
    });
    const by = bottom - 62;
    let bx = x0;
    if (dv.pages > 1) bx += G.button(cv, t, bx, by, 0, 52, 'Seite ' + (dv.page + 1) + '/' + dv.pages, act.devPager, { key: 'devpager' }) + 22;
    txt(cv, (dv.note || (dv.onHomeCount + ' Geraete auf Home, neue sind nur lesend')), bx, by + 36, 26, dv.noteBad ? (t.crit || '#ef2b2d') : t.dim, L);
    const rw = tww(cv, 'NEU LADEN', 21, { font: 'bold', spacing: 1.5 }) + 62;
    G.button(cv, t, W - 52 - rw, by, rw, 52, 'Neu laden', act.devRefresh, { key: 'devreload' });
}

function draw(cv, G, t, v, act) {
    cv.clear(t.bg);
    const badges = [];
    if (v.mode === 'demo') badges.push({ text: 'DEMO' });
    else if (v.mode === 'error') badges.push({ text: 'KONFIG', color: t.crit || '#ef2b2d' });
    else badges.push(v.readOnly ? { text: 'NUR LESEN', color: 'dim' } : { text: 'STEUERUNG AN', color: t.warn || '#d29922' });
    G.frame(cv, t, v.pages, v.pageIdx, badges);
    G.panel(cv, t, 24, G.TOP, W - 48, G.BOTTOM - G.TOP, null);
    const bottom = G.pageBottom(cv) - (cv.own ? G.MARGIN : 0);
    act = act || {};
    if (v.page === 'Home') drawHome(cv, G, t, v, act, bottom);
    else if (v.page === 'Auto an HA') drawCar(cv, G, t, v, act, bottom);
    else if (v.page === 'Verbinden') drawPair(cv, G, t, v, act, bottom);
    else if (v.page === 'Geraete') drawDevices(cv, G, t, v, act, bottom);
    else drawStatus(cv, G, t, v);
}

module.exports = { draw, W, H: 520 };
