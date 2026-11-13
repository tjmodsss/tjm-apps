'use strict';
/**
 * ui_favs.js - the Favoriten page. Groups sit in a row of cards (name plus the pairs' colours); a tap
 * opens that group. "+ Neu" and "Name" open a keyboard, and the typed name is what gets saved.
 */
const { withAlpha } = require('./kit/canvas');
const { pill } = require('./ui_parts');
const C = require('./color');

const TW = 380, TH = 118, GAP = 8, X0 = 24, Y0 = 124, BAR_Y = 380, MAX = 8;
const GY = 46, GH = 70, GW = 4 * 380 + 3 * 12;
const ROWS = ['ABCDEFGHIJ', 'KLMNOPQRST', 'UVWXYZÄÖÜß'];
const TEXT = { font: 'bold' };

function fit(cv, name, maxW, size) {
    if (cv.textWidth(name, size, TEXT) <= maxW) return name;
    let s = name;
    while (s.length > 1 && cv.textWidth(s.slice(0, -1) + '…', size, TEXT) > maxW) s = s.slice(0, -1);
    return s.slice(0, -1) + '…';
}

function cards(cv, t, m, act) {
    const groups = m.st.groups || [];
    const extra = groups.length < 6 ? 1 : 0;
    const n = groups.length + extra;
    const gap = 8;
    const w = Math.floor((GW - (n - 1) * gap) / n);
    groups.forEach((g, i) => {
        const x = X0 + i * (w + gap), on = i === m.st.group;
        cv.roundRect(x, GY, w, GH, 12, withAlpha('#ffffff', on ? 0.08 : 0.04));
        cv.strokeRoundRect(x, GY, w, GH, 12, on ? 2.5 : 1.5, on ? '#ffffff' : withAlpha('#ffffff', 0.16));
        cv.text(fit(cv, g.name, w - 28, 20), x + 14, GY + 28, 20, t.text, TEXT);
        const pairs = g.favs.slice(0, 6);
        if (!pairs.length) cv.text('Leer', x + 14, GY + 58, 16, t.dim, TEXT);
        else {
            const sw = Math.max(10, Math.floor((w - 28 - (pairs.length - 1) * 4) / pairs.length));
            pairs.forEach((f, k) => {
                const sx = x + 14 + k * (sw + 4);
                cv.roundRect(sx, GY + 40, sw, 9, 3, C.toRgb(f.upper));
                cv.roundRect(sx, GY + 52, sw, 9, 3, C.toRgb(f.lower));
            });
        }
        if (m.view.editFavs && groups.length > 1) {
            cv.circle(x + w - 18, GY + 18, 12, withAlpha(t.crit, 0.9));
            cv.text('X', x + w - 18, GY + 23, 14, '#ffffff', { align: 'center', font: 'bold' });
            cv.target(x + w - 32, GY + 4, 28, 28, () => act.deleteGroup(i), 'gdel-' + i, 12);
        }
        cv.target(x, GY, w, GH, () => act.setGroup(i), 'grp-' + i, 12);
    });
    if (extra) {
        const x = X0 + groups.length * (w + gap);
        cv.strokeRoundRect(x, GY, w, GH, 12, 1.5, withAlpha('#ffffff', 0.3));
        cv.text('+ Neu', x + w / 2, GY + GH / 2 + 8, 22, t.text, { align: 'center', font: 'bold' });
        cv.target(x, GY, w, GH, () => act.beginNew(), 'grp-new', 12);
    }
}

function keyboard(cv, t, m, act) {
    const draft = m.view.draft || '';
    const shift = !!m.view.shift;
    cv.text(m.view.naming === 'new' ? 'Neue Gruppe' : 'Name', X0, 58, 18, t.dim, TEXT);
    cv.roundRect(X0, 70, GW, 64, 14, withAlpha('#ffffff', 0.05));
    cv.text(draft || 'Name eingeben', X0 + 24, 112, 32, draft ? t.text : t.dim, TEXT);
    const kw = Math.floor((GW - 9 * 8) / 10), kh = 52, gy = 148;
    ROWS.forEach((row, ri) => {
        for (let i = 0; i < row.length; i++) {
            const ch = row.charAt(i);
            const label = ch === 'ß' ? 'ß' : (shift ? ch.toUpperCase() : ch.toLowerCase());
            const x = X0 + i * (kw + 8), y = gy + ri * (kh + 8);
            cv.roundRect(x, y, kw, kh, 10, withAlpha('#ffffff', 0.07));
            cv.text(label, x + kw / 2, y + kh / 2 + 8, 26, t.text, { align: 'center', font: 'bold' });
            cv.target(x, y, kw, kh, () => act.typeChar(ch), 'key-' + ch, 8);
        }
    });
    const y = gy + 3 * (kh + 8);
    const shiftW = kw * 2 + 8, spaceW = kw * 4 + 3 * 8, delW = kw * 2 + 8;
    cv.roundRect(X0, y, shiftW, kh, 10, shift ? withAlpha(t.sel || t.accent, 0.85) : withAlpha('#ffffff', 0.07));
    cv.text(shift ? 'ABC' : 'abc', X0 + shiftW / 2, y + kh / 2 + 8, 22, shift ? '#ffffff' : t.text, { align: 'center', font: 'bold' });
    cv.target(X0, y, shiftW, kh, () => act.toggleShift(), 'key-shift', 8);
    const sx = X0 + shiftW + 8;
    cv.roundRect(sx, y, spaceW, kh, 10, withAlpha('#ffffff', 0.07));
    cv.text('Leer', sx + spaceW / 2, y + kh / 2 + 8, 22, t.text, { align: 'center', font: 'bold' });
    cv.target(sx, y, spaceW, kh, () => act.typeChar(' '), 'key-space', 8);
    const dx = sx + spaceW + 8;
    cv.roundRect(dx, y, delW, kh, 10, withAlpha('#ffffff', 0.07));
    cv.text('Löschen', dx + delW / 2, y + kh / 2 + 8, 22, t.text, { align: 'center', font: 'bold' });
    cv.target(dx, y, delW, kh, () => act.backspace(), 'key-del', 8);
    const by = y + kh + 12;
    const ready = draft.trim().length > 0;
    pill(cv, t, X0, by, 280, 52, 'Abbrechen', () => act.cancelName(), { key: 'key-cancel' });
    pill(cv, t, X0 + 296, by, 280, 52, 'Fertig', () => act.commitName(), { off: !ready, key: 'key-ok' });
}

function draw(cv, t, m, act) {
    if (m.view.naming) { keyboard(cv, t, m, act); return; }
    cards(cv, t, m, act);
    const favs = m.base.favs, edit = m.view.editFavs;
    for (let i = 0; i < MAX; i++) {
        const x = X0 + (i % 4) * (TW + GAP), y = Y0 + Math.floor(i / 4) * (TH + GAP), f = favs[i];
        if (!f) {
            const next = i === favs.length && !edit;
            cv.strokeRoundRect(x, y, TW, TH, 14, 1.5, withAlpha('#ffffff', next ? 0.3 : 0.12));
            cv.text(next ? '+ Hier speichern' : 'Leer', x + TW / 2, y + TH / 2 + 8, 20, t.dim, { align: 'center', font: 'bold' });
            if (next) cv.target(x, y, TW, TH, () => act.addFav(), 'fav-' + i, 14);
            continue;
        }
        cv.roundRect(x, y, TW, TH, 14, withAlpha('#ffffff', 0.05));
        cv.roundRect(x + 24, y + 18, TW - 48, 20, 10, f.upper);
        cv.roundRect(x + 24, y + 46, TW - 48, 20, 10, f.lower);
        cv.text('Favorit ' + (i + 1), x + 24, y + 100, 22, t.text, { font: 'bold' });
        if (edit) {
            cv.circle(x + TW - 36, y + TH - 28, 18, withAlpha(t.crit, 0.9));
            cv.text('X', x + TW - 36, y + TH - 22, 20, '#ffffff', { align: 'center', font: 'bold' });
            cv.target(x + TW - 58, y + TH - 50, 44, 44, () => act.removeFav(i), 'del-' + i, 18);
        } else cv.target(x, y, TW, TH, () => act.applyFav(i), 'fav-' + i, 14);
    }
    cv.roundRect(X0, BAR_Y, GW, 100, 14, withAlpha('#ffffff', 0.04));
    let x = X0 + 16;
    x += pill(cv, t, x, BAR_Y + 26, 320, 48, '+ Aktuelle speichern', () => act.addFav(),
        { off: favs.length >= MAX || edit, key: 'save' }) + 12;
    x += pill(cv, t, x, BAR_Y + 26, 200, 48, edit ? 'Fertig' : 'Bearbeiten', () => act.toggleEdit(),
        { off: !favs.length && !edit, key: 'edit' }) + 12;
    pill(cv, t, x, BAR_Y + 26, 160, 48, 'Name', () => act.beginRename(), { key: 'rename' });
}

module.exports = { title: 'Favoriten', draw };
