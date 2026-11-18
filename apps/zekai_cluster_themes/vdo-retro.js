'use strict';

const { FONTS } = require('./instrument-type');

const C = {
    bezel: '#9ca0a2', faceEdge: '#5d6266', face: '#34393e', faceShade: '#292e33',
    ink: '#f2efe4', soft: '#c6c8c5', dim: '#858a8d', needle: '#e5bb75',
    red: '#e85b3e', green: '#31a56a', blue: '#537ec3', amber: '#dfad4d',
    glass: '#14171a', lcd: '#a6a17e', lcdInk: '#30332b',
};
const TANK_LITRES = 83;
const KM_PER_MILE = 1.609344;

function vdoPanel(canvas, data, opts = {}) {
    const scale = opts.scale || 1;
    const ox = opts.x || 0;
    const oy = opts.y || 0;
    const x = (v) => ox + v * scale;
    const y = (v) => oy + v * scale;
    const line = (x1, y1, x2, y2, width, colour) => canvas.line(x(x1), y(y1), x(x2), y(y2), width * scale, colour);
    const circle = (cx, cy, r, colour) => canvas.circle(x(cx), y(cy), r * scale, colour);
    const round = (rx, ry, w, h, r, colour) => canvas.roundRect(x(rx), y(ry), w * scale, h * scale, r * scale, colour);
    const text = (value, cx, cy, size, colour = C.ink, align = 'center', weight = 'regular', font = FONTS[weight]) =>
        canvas.text(String(value), x(cx), y(cy), size * scale, colour, { literal: true, align, font });
    const point = (cx, cy, radius, angle) => {
        const a = angle * Math.PI / 180;
        return [cx + Math.sin(a) * radius, cy - Math.cos(a) * radius];
    };
    const tick = (cx, cy, r1, r2, angle, width, colour) => {
        const a = point(cx, cy, r1, angle), b = point(cx, cy, r2, angle);
        line(a[0], a[1], b[0], b[1], width, colour);
    };
    const needle = (cx, cy, radius, angle, width = 2.2) => {
        const tail = point(cx, cy, 23, angle + 180), tip = point(cx, cy, radius, angle);
        line(tail[0] + 1, tail[1] + 1, tip[0] + 1, tip[1] + 1, width + 2, '#111315');
        line(tail[0], tail[1], tip[0], tip[1], width, C.needle);
        circle(cx, cy, 7, '#17191b');
        circle(cx, cy, 4, C.needle);
    };
    const dialFace = (cx, cy, radius) => {
        circle(cx, cy, radius + 4, '#101214');
        circle(cx, cy, radius + 2, C.bezel);
        circle(cx, cy, radius - 1, C.faceEdge);
        circle(cx, cy, radius - 4, C.face);
        circle(cx, cy, radius - 12, C.faceShade);
        circle(cx, cy, radius - 14, C.face);
    };

    const speed = Number.isFinite(data.speed) ? data.speed : null; // BMW signal is km/h.
    const speedMph = speed === null ? null : speed / KM_PER_MILE;
    const rpm = Number.isFinite(data.rpm) ? data.rpm : null;
    const mpg = Number.isFinite(data.economyMpgUs) ? data.economyMpgUs : null;
    const odoMiles = Number.isFinite(data.odometerKm) ? Math.floor(data.odometerKm / KM_PER_MILE) : null;
    const tripMiles = Number.isFinite(data.tripKm) ? data.tripKm / KM_PER_MILE : null;
    const fuelFraction = Number.isFinite(data.fuelLitres) ? Math.max(0, Math.min(1, data.fuelLitres / TANK_LITRES)) : null;

    const speedCx = 228, tachCx = 732, dialCy = 163, dialRadius = 141;
    const paintBackground = opts.paintBackground || ((paint) => paint());
    paintBackground(() => {
        // Leave clearance around the bezel on the 1920×720 panel.
        round(75, 14, 810, 298, 12, '#181a1c');
        round(80, 18, 800, 290, 10, '#25282b');
        speedometerFace(speedCx, dialCy, dialRadius);
        tachometerFace(tachCx, dialCy, dialRadius);
    });
    drawSpeedometer(speedCx, dialCy);
    drawTachometer(tachCx, dialCy);
    drawCentreStack();
    return canvas;

    function speedometerFace(cx, cy, r) {
        dialFace(cx, cy, r);
        // Outer MPH ring: 0 to 120 with a 10 mph face cadence.
        for (let value = 0; value <= 120; value += 5) {
            const a = 225 + value / 120 * 270;
            const major = value % 10 === 0;
            tick(cx, cy, major ? 124 : 130, 136, a, major ? 2.3 : 1.2, C.ink);
            if (major) {
                const p = point(cx, cy, 112, a);
                text(value, p[0], p[1] + 4, 13, C.ink, 'center', 'bold');
            }
        }
        // Inner km/h ring: a finer secondary scale on the same physical dial.
        for (let value = 0; value <= 200; value += 10) {
            const a = 225 + value / 200 * 270;
            const major = value % 20 === 0;
            tick(cx, cy, major ? 91 : 96, 101, a, major ? 1.5 : 0.8, C.soft);
            if (major) {
                const p = point(cx, cy, 79, a);
                text(value, p[0], p[1] + 3, 7, C.soft);
            }
        }
        text('VDO', cx, 106, 11, C.ink, 'center', 'bold');
        text('ODO · mi', cx, 121, 8, C.soft);
    }

    function drawSpeedometer(cx, cy) {
        if (speedMph !== null) needle(cx, cy, 103, 225 + Math.max(0, Math.min(120, speedMph)) / 120 * 270, 2.5);
        // Mechanical-style odometer rollers, now rendered as crisp electronic digits.
        drawCounter(cx - 51, 139, odoMiles === null ? '------' : String(odoMiles).padStart(6, '0').slice(-6));
        text('TRIP', cx, 197, 8, C.soft, 'center', 'medium');
        text(tripMiles === null ? '---.- mi' : tripMiles.toFixed(1).padStart(5, '0') + ' mi', cx, 214, 11, C.ink, 'center', 'medium');
        text('km/h', cx, 239, 9, C.soft, 'center', 'medium');
        text('MPH', cx, 255, 9, C.ink, 'center', 'bold');
    }

    function drawCounter(left, top, value) {
        for (let i = 0; i < 6; i++) {
            round(left + i * 17, top, 16, 20, 1.5, '#151719');
            round(left + i * 17 + 1, top + 1, 14, 18, 1, '#0b0d0f');
            text(value[i] || '-', left + i * 17 + 8, top + 15, 13, C.ink, 'center', 'bold');
        }
    }

    function tachometerFace(cx, cy, r) {
        dialFace(cx, cy, r);
        for (let value = 0; value <= 70; value += 2) {
            const a = 225 + value / 70 * 270;
            const major = value % 10 === 0;
            const redline = value >= 65;
            tick(cx, cy, major ? 124 : 130, 136, a, major ? 2.3 : 1.2, redline ? C.red : C.ink);
            if (major) {
                const p = point(cx, cy, 111, a);
                const edgeOffset = value === 0 ? -11 : value === 70 ? 11 : 0;
                text(value / 10, p[0] + edgeOffset, p[1] + 4, 14, C.ink, 'center', 'bold');
            }
        }
        text('1/min × 1000', cx, 108, 9, C.ink, 'center', 'medium');
        // A restrained red band echoes the original VDO rev-limit warning.
        for (let i = 0; i < 3; i++) {
            const p1 = point(cx, cy, 129 + i * 2, 225 + (65 + i * 1.7) / 70 * 270);
            const p2 = point(cx, cy, 137, 225 + (65 + i * 1.7) / 70 * 270);
            line(p1[0], p1[1], p2[0], p2[1], 2.2, C.red);
        }
    }

    function drawTachometer(cx, cy) {
        needle(cx, cy, 105, 225 + Math.max(0, Math.min(7000, rpm || 0)) / 7000 * 270, 2.5);
        const coolant = Number.isFinite(data.coolant) ? data.coolant : null;
        miniGauge(cx - 54, 242, 25, coolant === null ? null : Math.max(0, Math.min(130, coolant)) / 130,
            'COOLANT', coolant === null ? '--' : Math.round(coolant) + '°C');
        miniGauge(767, 242, 25, fuelFraction, 'FUEL',
            fuelFraction === null ? '--' : Math.round(data.fuelLitres) + ' L');
    }

    function miniGauge(cx, cy, radius, fraction, label, reading) {
        circle(cx, cy, radius + 3, '#202326');
        for (let i = 0; i <= 4; i++) {
            const a = 225 + i / 4 * 270;
            tick(cx, cy, radius - 2, radius - 7, a, 1, C.soft);
        }
        if (fraction !== null) {
            const angle = 225 + fraction * 270;
            const tail = point(cx, cy, 4, angle + 180);
            const tip = point(cx, cy, radius - 7, angle);
            line(tail[0], tail[1], tip[0], tip[1], 1.5, C.needle);
        }
        circle(cx, cy, 4, '#17191b');
        if (fraction !== null) circle(cx, cy, 2.4, C.needle);
        text(label, cx, cy + 12, 5.5, C.soft, 'center', 'medium');
        text(reading, cx, cy + 23, 6, C.ink);
    }

    function drawCentreStack() {
        const left = 426, width = 108, cx = 480;
        const topGroupY = 30;
        round(left, topGroupY, width, 72, 4, '#16191c');
        round(left + 3, topGroupY + 3, width - 6, 66, 2, '#292d31');
        text('MPG', cx, topGroupY + 15, 10, C.ink, 'center', 'bold');
        // Compact, upper-arc economy gauge, contained entirely by the factory-style frame.
        const mpgCy = topGroupY + 59;
        for (let value = 0; value <= 70; value += 5) {
            const a = 270 + (70 - value) / 70 * 180;
            const major = value % 10 === 0;
            tick(cx, mpgCy, major ? 31 : 35, 41, a, major ? 1.25 : 0.8, C.soft);
        }
        [
            [70, 270], [45, 320], [35, 360], [25, 400],
        ].forEach(([value, angle]) => {
            const p = point(cx, mpgCy, 27, angle);
            text(value, p[0], p[1] + 2, 7, C.ink, 'center', 'medium');
        });
        const economyAngle = mpg === null ? 360 : 270 + (70 - Math.max(0, Math.min(70, mpg))) / 70 * 180;
        const ep = point(cx, mpgCy, 31, economyAngle);
        line(cx, mpgCy, ep[0], ep[1], 1.3, C.needle);
        circle(cx, mpgCy, 2.7, C.needle);

        // The original VDO center strip uses four monochrome pictograms above the colored lenses.
        const iconY = 138;
        drawStatusIcon('turn', left + 14.5, iconY);
        drawStatusIcon('battery', left + 33.5, iconY);
        drawStatusIcon('oil', left + 71.5, iconY);
        drawStatusIcon('beam', left + 90.5, iconY);

        const firstRowLamps = [
            '#15583a', '#742f32', '#6d5326', '#74372e', '#25446f',
        ];
        for (let row = 0; row < 2; row++) {
            for (let col = 0; col < 5; col++) {
                const xx = left + 7 + col * 19, yy = 162 + row * 16;
                round(xx, yy, 15, 13, 2, '#151719');
                const glass = row === 0 ? firstRowLamps[col] : '#202326';
                circle(xx + 7.5, yy + 6.5, 4.2, glass);
                canvas.strokeRoundRect(x(xx), y(yy), 15 * scale, 13 * scale, 2 * scale, 0.8 * scale, '#3c4144');
            }
        }
        // Keep all three center-stack sections within the compact marked area.
        round(left + 3, 213, width - 6, 75, 2, '#111413');
        round(left + 7, 217, width - 14, 67, 2, C.lcd);
        text('SPEED', cx, 230, 7, C.lcdInk, 'center', 'bold');
        text(speed === null ? '--' : String(Math.round(speed)), cx, 258, 24, C.lcdInk, 'center', 'bold', 'num');
        const mphText = speedMph === null ? '--' : String(Math.round(speedMph));
        text('km/h  ·  ' + mphText + ' mph', cx, 275, 6.5, C.lcdInk, 'center', 'medium');
    }

    function drawStatusIcon(kind, cx, cy) {
        const colour = '#bfc2c3';
        if (kind === 'turn') {
            line(cx - 7, cy, cx - 1, cy, 1.1, colour);
            line(cx - 7, cy, cx - 4, cy - 2.5, 1.1, colour);
            line(cx - 7, cy, cx - 4, cy + 2.5, 1.1, colour);
            line(cx + 1, cy, cx + 7, cy, 1.1, colour);
            line(cx + 7, cy, cx + 4, cy - 2.5, 1.1, colour);
            line(cx + 7, cy, cx + 4, cy + 2.5, 1.1, colour);
        } else if (kind === 'battery') {
            round(cx - 5.5, cy - 3.5, 11, 7, 0.7, '#25292c');
            canvas.strokeRoundRect(x(cx - 5.5), y(cy - 3.5), 11 * scale, 7 * scale, 0.7 * scale, 0.8 * scale, colour);
            line(cx - 3.5, cy - 4.5, cx - 1.5, cy - 4.5, 0.8, colour);
            line(cx + 1.5, cy - 4.5, cx + 3.5, cy - 4.5, 0.8, colour);
            line(cx - 2.5, cy - 1, cx - 2.5, cy + 1.5, 0.7, colour);
            line(cx - 3.7, cy + 0.25, cx - 1.3, cy + 0.25, 0.7, colour);
            line(cx + 1.2, cy + 0.25, cx + 3.5, cy + 0.25, 0.7, colour);
        } else if (kind === 'oil') {
            line(cx - 4.5, cy - 1.8, cx - 2, cy - 3.4, 0.9, colour);
            line(cx - 2, cy - 3.4, cx + 2.8, cy - 3.4, 0.9, colour);
            line(cx + 2.8, cy - 3.4, cx + 4.5, cy - 1.8, 0.9, colour);
            line(cx - 4.5, cy - 1.8, cx - 4.5, cy + 1.8, 0.9, colour);
            line(cx - 4.5, cy + 1.8, cx + 3, cy + 1.8, 0.9, colour);
            line(cx + 3, cy + 1.8, cx + 4.5, cy, 0.9, colour);
            line(cx + 4.5, cy, cx + 6.5, cy, 0.9, colour);
            circle(cx + 5.5, cy + 3, 0.85, colour);
        } else if (kind === 'beam') {
            line(cx - 4, cy - 3.5, cx - 1.5, cy - 2.5, 0.9, colour);
            line(cx - 1.5, cy - 2.5, cx - 1.5, cy + 2.5, 0.9, colour);
            line(cx - 1.5, cy + 2.5, cx - 4, cy + 3.5, 0.9, colour);
            line(cx - 4, cy - 3.5, cx - 4, cy + 3.5, 0.9, colour);
            line(cx + 1, cy - 3.2, cx + 5, cy - 4, 0.75, colour);
            line(cx + 1, cy - 1.1, cx + 5, cy - 1.1, 0.75, colour);
            line(cx + 1, cy + 1.1, cx + 5, cy + 1.1, 0.75, colour);
            line(cx + 1, cy + 3.2, cx + 5, cy + 4, 0.75, colour);
        }
    }
}

module.exports = { vdoPanel };
