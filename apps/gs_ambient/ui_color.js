'use strict';
/**
 * ui_color.js - the Farbe page: the colour wheel (left) and a sketch of the interior (right) with the upper
 * and lower light line in the colours being sent. A tap on a line picks the zone the wheel edits; below
 * it the saturation and brightness sliders, Tauschen and Gleich.
 */
const G = require('./kit/gauges');
const { withAlpha } = require('./kit/canvas');
const C = require('./color');
const { pill, slider } = require('./ui_parts');

const WX = 300, WY = 282, WR = 200, RINGS = 16;
const HUES = [0, 60, 120, 180, 240, 300, 360];
const PX = 580, PW = 990;

/** The wheel: RINGS rings, each through all hues at its saturation; recorded once as a layer. */
function wheel() {
    return G.layer('gs_ambient_wheel', WR * 2 + 4, WR * 2 + 4, (r) => {
        const c = WR + 2;
        for (let i = 0; i < RINGS; i++) {
            const s = (i + 0.5) / RINGS;
            r.arc(c, c, i * WR / RINGS, (i + 1) * WR / RINGS + 0.5, 0, 360, '#ffffff',
                { ramp: HUES.map((h) => C.hsvToRgb(h, s, 1)), rampFrom: 0, rampTo: 360 });
        }
    });
}

/** The zone marker under the finger, if it lands on one. A tap there picks that zone. */
function markerNear(st, x, y) {
    let hit = null, best = 36 * 36;
    ['upper', 'lower'].forEach((z) => {
        const p = C.toPoint(st[z], WR);
        const dx = x - (WX + p[0]), dy = y - (WY + p[1]);
        const d = dx * dx + dy * dy;
        if (d <= best) { best = d; hit = z; }
    });
    return hit;
}

function draw(cv, t, m, act) {
    const st = m.st;
    cv.blit(wheel(), WX - WR - 2, WY - WR - 2);
    ['upper', 'lower'].forEach((z) => {
        const p = C.toPoint(st[z], WR), on = z === st.zone;
        cv.circle(WX + p[0], WY + p[1], on ? 22 : 12, on ? '#ffffff' : withAlpha('#ffffff', 0.6));
        cv.circle(WX + p[0], WY + p[1], on ? 16 : 8, C.toRgb(st[z]));
    });
    cv.target(WX - WR, WY - WR, WR * 2, WR * 2, () => act.toggleZone(), 'wheel', WR, {
        drag: (phase, x, y) => {
            if (phase === 1) {
                const hit = markerNear(act.get(), x, y);
                if (hit) { act.zone(hit); return; }
            }
            if (phase === 3) return;
            act.wheel(C.fromPoint(x - WX, y - WY, WR));
        },
        turn: (d) => act.turnHue(d),
    });

    G.panel(cv, t, PX, 52, PW, 262, 'Vorschau Innenraum');
    [['upper', 160, 'Oben'], ['lower', 250, 'Unten']].forEach((row) => {
        const z = row[0], y = row[1], on = z === st.zone, c = C.scale(m.frame[z], m.frame.brightness);
        cv.line(PX + 170, y, PX + PW - 50, y, 24, withAlpha(c, 0.3));
        cv.line(PX + 170, y, PX + PW - 50, y, 6, c);
        cv.text(row[2].toUpperCase(), PX + 32, y + 8, 20, on ? t.text : t.dim, { font: 'bold', spacing: 1.5 });
        if (on) cv.strokeRoundRect(PX + 14, y - 30, PW - 28, 60, 14, 2, '#ffffff');
        cv.target(PX + 14, y - 30, PW - 28, 60, () => act.zone(z), 'zone-' + z, 14);
    });

    slider(cv, t, PX, 352, PW, 'Sättigung', () => { const s = act.get(); return s[s.zone].s; }, (v) => act.setSat(v), 0.05, 'sat');
    slider(cv, t, PX, 410, PW, 'Helligkeit', () => act.get().brightness, (v) => act.setBrightness(v), 0.05, 'bri');
    const x = PX + 24 + pill(cv, t, PX + 24, 448, 220, 48, 'Tauschen', () => act.swap()) + 16;
    pill(cv, t, x, 448, 220, 48, 'Gleich', () => act.same());
}

module.exports = { title: 'Farbe', draw, WX, WY, WR };
