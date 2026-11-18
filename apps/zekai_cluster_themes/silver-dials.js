'use strict';

const { instrumentType } = require('./instrument-type');
const { SILVER_SIDE_DIALS, SILVER_SIDE_Y: SIDE_Y } = require('./panel-layout');

// 2019 X5 xDrive40i, BMW Canada MY19 product guide. The raw KombiIF field is litres.
const TANK_LITRES = 83;
const SPEED_SCALE_KMH = 260;
const RPM_SCALE = 8000;
const CENTRE_Y = 165;
const CHROME = '#e8e9ed';
const SILVER = '#bec2cb';
const DEMO = {
    speed: 0, rpm: 780, range: 520, fuelLitres: 83, ambient: 15, stage: 'P', clock: '13:50',
};

function point(cx, cy, angle, radius, cross = 0) {
    const rad = angle * Math.PI / 180;
    const sin = Math.sin(rad);
    const cos = Math.cos(rad);
    return [cx + sin * radius + cos * cross, cy - cos * radius + sin * cross];
}

function fraction(value, max) {
    return Number.isFinite(value) && value >= 0 && value <= max ? value / max : null;
}

function valueText(value, decimals = 0) {
    return Number.isFinite(value) ? value.toFixed(decimals) : '--';
}

function silverDials(canvas, data, opts, selections, paintSlot) {
    const readings = opts.demo ? DEMO : data;
    const scale = opts.scale || 1;
    const x = (v) => (opts.x || 0) + v * scale;
    const y = (v) => (opts.y || 0) + v * scale;
    const ring = (cx, cy, r0, r1, a0, a1, colour, ramp) =>
        canvas.arc(x(cx), y(cy), r0 * scale, r1 * scale, a0, a1, colour, ramp ? { ramp } : undefined);
    const disc = (cx, cy, radius, colour) => canvas.circle(x(cx), y(cy), radius * scale, colour);
    const face = (cx, cy, radius, stops) =>
        canvas.card(x(cx - radius), y(cy - radius), radius * 2 * scale, radius * 2 * scale, radius * scale, stops);
    const line = (a, b, width, colour) => canvas.line(x(a[0]), y(a[1]), x(b[0]), y(b[1]), width * scale, colour);
    const plate = (points, colour) => canvas.quad(points.map(([px, py]) => [x(px), y(py)]), colour);
    const { text, fitBold } = instrumentType(canvas, x, y, scale, CHROME);

    function mark(cx, cy, angle, inner, outer, width, colour) {
        line(point(cx, cy, angle, inner), point(cx, cy, angle, outer), width, colour);
    }

    function sideFace(slot, defaultKind) {
        const cx = SILVER_SIDE_DIALS[slot];
        const left = slot === 'leftInner';
        const r = 96;
        const start = left ? 137 : -44;
        const end = left ? 405 : 224;
        const open = '#0c0e1300';
        // The crescent fades toward the middle of the cluster.
        for (let halo = 11; halo >= 1; halo -= 2) {
            const peak = Math.round(40 - halo * 2);
            const glow = [184, 192, 214, peak];
            ring(cx, SIDE_Y, r + halo - 1, r + halo + 1, start, end, open, [open, glow, '#999eb619', glow, open]);
        }
        face(cx, SIDE_Y, r - 1, [[0, '#050608'], [0.36, '#10121b'], [0.6, '#181b28'], [1, '#07080c']]);
        ring(cx, SIDE_Y, r - 5, r - 2, start, end, '#181b22', [open, '#515763', '#42454e', '#777c85', open]);
        ring(cx, SIDE_Y, r - 2, r + 1, start, end, CHROME, [open, '#e5e6ec', '#fbfaf7', '#dbdce5', open]);

        if ((selections[slot] || defaultKind) !== defaultKind) return;
        const sign = left ? -1 : 1;
        for (let n = 0; n <= 42; n++) {
            const angle = sign * n * (180 / 42);
            const major = n % 21 === 0;
            mark(cx, SIDE_Y, angle, major ? 40 : 49, major ? 71 : 56, major ? 1.1 : 0.7,
                major ? '#b2b3bc' : '#525666');
        }
        text(left ? '8' : '100', cx, SIDE_Y - 68, 14, SILVER, 'bold');
        text(left ? '4' : '50', cx + sign * 75, SIDE_Y + 5, 14, SILVER, 'bold');
        text(left ? '0' : '0%', cx, SIDE_Y + 78, 13, SILVER, 'bold');

        disc(cx, SIDE_Y, 10, '#050609');
    }

    function sideReading(slot, defaultKind, value) {
        const cx = SILVER_SIDE_DIALS[slot];
        const kind = selections[slot] || defaultKind;
        if (kind !== defaultKind) {
            if (opts.mapSlot !== slot) paintSlot(kind, cx, SIDE_Y);
            return;
        }
        if (value === null) return;
        const angle = (slot === 'leftInner' ? -1 : 1) * (1 - value) * 180;
        const inner = point(cx, SIDE_Y, angle, -21);
        const tip = point(cx, SIDE_Y, angle, 68);
        line(inner, tip, 3.2, '#5f626c');
        line(inner, tip, 1.4, '#e5e3df');
    }

    const rpm = fraction(readings.rpm, RPM_SCALE);
    const fuel = fraction(readings.fuelLitres, TANK_LITRES);
    const paintBackground = opts.paintBackground || ((paint) => paint());
    paintBackground(() => {
        sideFace('leftInner', 'rpm');
        sideFace('rightInner', 'fuelRange');
        disc(480, CENTRE_Y, 121, '#2e3137');
        ring(480, CENTRE_Y, 119, 121, 0, 360, '#92949b', ['#9598a0', '#464951', '#252830', '#5f636b', '#9598a0']);
        ring(480, CENTRE_Y, 114, 118, 0, 360, '#101217');
        face(480, CENTRE_Y, 113, [[0, '#a4a5a9'], [0.22, '#e5e3df'], [0.48, '#f7f4ee'], [0.74, '#f3f1eb'], [1, '#a6a8ac']]);
        ring(480, CENTRE_Y, 111, 113, 0, 360, '#5c6068', ['#5b5d63', '#a7a6a5', '#70737a', '#a7a6a5', '#5b5d63']);

        for (let n = 0; n <= 84; n++) {
            const angle = -136 + (272 / 84) * n;
            const major = n % 14 === 0;
            mark(480, CENTRE_Y, angle, major ? 54 : 69, major ? 100 : 82,
                major ? 1.0 : 0.55, major ? '#90909780' : '#99989e65');
        }
        text('R', 477, CENTRE_Y - 37, 23, '#a2a1a580');
        text('R', 483, CENTRE_Y - 31, 23, '#a2a1a580');

        disc(480, CENTRE_Y, 18, '#d6d3cf');
        disc(480, CENTRE_Y, 11, '#272729');
    });
    sideReading('leftInner', 'rpm', rpm);
    sideReading('rightInner', 'fuelRange', fuel);
    const speed = Number.isFinite(readings.speed) && readings.speed >= 0 ? readings.speed : null;
    if (speed !== null) {
        const angle = -136 + Math.min(speed / SPEED_SCALE_KMH, 1) * 272;
        const p = (distance, cross) => point(480, CENTRE_Y, angle, distance, cross);
        plate([p(95, 0), p(-28, 0), p(-16, -17), p(80, -34)], '#5c60665c');
        plate([p(95, 0), p(-28, 0), p(-12, -13), p(85, -24)], '#a3a6aa');
        plate([p(95, 0), p(-28, 0), p(-16, -6), p(90, -11)], '#d9d8d5');
        line(p(95, 0), p(-28, 0), 1.4, '#5b5f65');
    }
    const speedText = valueText(speed);
    text(speedText, 480, CENTRE_Y + 58, fitBold(speedText, 54, 130), '#292c32', 'bold');
    text('KM/H', 480, CENTRE_Y + 76, 13, '#56585d', 'bold', 1.1);

    text(valueText(readings.rpm), 360, 280, 25);
    text('RPM', 360, 298, 11, SILVER, 'bold', 1.0);
    text(valueText(readings.range), 600, 280, 25);
    text('KM RANGE', 600, 298, 11, SILVER, 'bold', 0.9);

    const clock = opts.demo ? DEMO.clock : opts.clock || '--:--';
    text(clock, 155, 249, 19, SILVER);
    text(Number.isFinite(readings.ambient) ? valueText(readings.ambient, 1) + '°C' : '--°C', 808, 249, 19, SILVER);
    const inPark = (readings.stage === 'P' || readings.selection === 'P')
        && readings.stage !== 'other' && readings.selection !== 'other';
    ['R', 'N', 'D'].forEach((gear, index) => text(gear, 811, 160 + index * 18, 16, '#7f8490'));
    if (inPark) text('P', 829, 178, 16, CHROME, 'bold');
}

module.exports = { silverDials, TANK_LITRES };
