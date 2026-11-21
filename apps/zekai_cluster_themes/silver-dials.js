'use strict';

const { instrumentType } = require('./instrument-type');
const { SILVER_SIDE_DIALS, SILVER_SIDE_Y: SIDE_Y, SILVER_CENTRE, SILVER_BEZEL } = require('./panel-layout');

// 2019 X5 xDrive40i, BMW Canada MY19 product guide. The raw KombiIF field is litres.
const TANK_LITRES = 83;
const SPEED_SCALE_KMH = 260;
const RPM_SCALE = 8000;
const CENTRE_Y = SILVER_CENTRE[1];
const SIDE_NEEDLE_SCALE = 68 / 95;
const TRAIL_LIFETIME_MS = 650;
const TRAIL_MAX_SAMPLES = 8;
const CHROME = '#e8e9ed';
const SILVER_TEXT = '#ffffff';
const SILVER_TEXT_SHADOW = { colour: [13, 17, 27, 184], offset: 0.8 };
const SIDE_BEZEL_GAP = 84;
const SIDE_BEZEL_GLOW = Array.from({ length: 10 }, (_, band) => {
    const opacity = 90 * (1 - band / 10) ** 2;
    const strengths = [0, 0.12, 1, 0.78, 0.54, 0.46, 0.42, 0.46, 0.54, 0.78, 1, 0.12, 0];
    return strengths.map((strength) => [194, 206, 232, Math.round(opacity * strength)]);
});
const SIDE_BEZEL_RIM = [
    '#d2d8e800', '#dce1ef40', '#fbfaf7', '#edf0f4', '#dbdce5', '#cdd2df', '#c7ccd7',
    '#cdd2df', '#dbdce5', '#edf0f4', '#fbfaf7', '#dce1ef40', '#d2d8e800',
];
const SILVER_SPEED_LABEL = { x: SILVER_CENTRE[0], y: CENTRE_Y + 78, size: 54, maxWidth: 130 };
const SILVER_GEAR_LABEL = { x: 346, firstBaseline: 255, step: 13, size: 14 };
const SILVER_PALETTES = {
    silver: { upper: '#252730', mid: '#484a55', lower: '#747783', rim: '#d4d6df', side: '#181b28' },
    amethyst: { upper: '#221a32', mid: '#4b365e', lower: '#9574a9', rim: '#b696d0', side: '#20182c' },
    cuprite: { upper: '#351a2c', mid: '#752c45', lower: '#e56b69', rim: '#df7985', side: '#211622' },
    chalcedon: { upper: '#344956', mid: '#6d8697', lower: '#c5d5dd', rim: '#bed7e8', side: '#16232d', lightFace: true },
    lapis: { upper: '#182741', mid: '#2b4671', lower: '#6d92c6', rim: '#93b4e2', side: '#171e31' },
    fireOpal: { upper: '#593036', mid: '#ca6545', lower: '#ffbf83', rim: '#f7b789', side: '#211c29', lightFace: true },
    gold: { upper: '#25242c', mid: '#42414c', lower: '#686579', rim: '#d6b379', side: '#191c29' },
    citrine: { upper: '#57421d', mid: '#b38535', lower: '#f6d888', rim: '#ebc771', side: '#21202a', lightFace: true },
    jade: { upper: '#254444', mid: '#4e8d83', lower: '#a7d9cd', rim: '#a4d8d1', side: '#14282d', lightFace: true },
    peridot: { upper: '#414526', mid: '#818748', lower: '#c2c980', rim: '#c4c985', side: '#19242b', lightFace: true },
};
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

function sideLabel(slot, custom) {
    const sign = slot === 'leftInner' ? 1 : -1;
    return { x: SILVER_SIDE_DIALS[slot] + sign * (custom ? 108 : 51), y: custom ? 280 : SIDE_Y + 10, size: 25 };
}

function speedAngle(speed) {
    return Number.isFinite(speed) && speed >= 0 ? -136 + Math.min(speed / SPEED_SCALE_KMH, 1) * 272 : null;
}

function rpmAngle(rpm) {
    const value = fraction(rpm, RPM_SCALE);
    return value === null ? null : (value - 1) * 180;
}

function paintSilverNeedle(canvas, cx, cy, angle, scale, centre, lightFace) {
    const size = centre ? 1 : SIDE_NEEDLE_SCALE;
    const p = (distance, cross = 0) => point(cx, cy, angle, distance * size * scale, cross * size * scale);
    const line = (a, b, width, colour) => canvas.line(a[0], a[1], b[0], b[1], width * scale, colour);
    const shadow = (width) => [p(94), p(-23), p(-16, -width * 0.68), p(71, -width)];
    if (canvas.featheredQuad) {
        canvas.featheredQuad(shadow(29), '#05070e9c', [1, 9 * size * scale, 28 * size * scale, 11 * size * scale]);
    } else {
        // The preview recorder supports solid polygons.
        for (let width = 29; width >= 2; width -= 2.5) canvas.quad(shadow(width), '#05070e13');
    }
    if (centre) {
        const blade = [p(95), p(6, 2.5), p(-23), p(6, -3.5)];
        canvas.quad(blade, '#08090b');
        line(blade[0], blade[3], 0.9, lightFace ? '#626670' : '#bac0cd');
    } else {
        line(p(-23), p(95), 2.8, '#07080b');
        line(p(-23), p(95), 1.15, '#dedfe7');
    }
}

function updateSilverTrail(trail, speed, now) {
    const angle = speedAngle(speed);
    const gap = now - trail.now;
    const samples = angle === null || gap < 0 || gap >= TRAIL_LIFETIME_MS
        ? [] : (trail.samples || []).filter((sample) => now - sample.at < TRAIL_LIFETIME_MS);
    if (angle !== null && gap >= 0 && gap < TRAIL_LIFETIME_MS && Number.isFinite(trail.angle) && angle !== trail.angle) {
        samples.push({ angle: trail.angle, direction: Math.sign(angle - trail.angle), at: now });
        if (samples.length > TRAIL_MAX_SAMPLES) samples.shift();
    }
    trail.now = now;
    trail.angle = angle;
    trail.samples = samples;
    return trail;
}

function silverDials(canvas, data, opts, selections, paintSlot) {
    const readings = opts.demo ? DEMO : data;
    const palette = SILVER_PALETTES[selections.faceColour] || SILVER_PALETTES.silver;
    const centreMark = palette.lightFace ? '#202a3c70' : '#d1d4e27a';
    const fineMark = palette.lightFace ? '#202a3c4e' : '#c4c7d45c';
    const scale = opts.scale || 1;
    const x = (v) => (opts.x || 0) + v * scale;
    const y = (v) => (opts.y || 0) + v * scale;
    const ring = (cx, cy, r0, r1, a0, a1, colour, ramp) =>
        canvas.arc(x(cx), y(cy), r0 * scale, r1 * scale, a0, a1, colour, ramp ? { ramp } : undefined);
    const disc = (cx, cy, radius, colour) => canvas.circle(x(cx), y(cy), radius * scale, colour);
    const radialGlow = (cx, cy, radius, colour, inner = 0) =>
        canvas.radialGlow(x(cx), y(cy), radius * scale, colour, inner * scale);
    const line = (a, b, width, colour) => canvas.line(x(a[0]), y(a[1]), x(b[0]), y(b[1]), width * scale, colour);
    const { text, fitBold } = instrumentType(canvas, x, y, scale, SILVER_TEXT);
    const speedText = (value, cx, cy, size, spacing = 0) => {
        if (palette.lightFace) {
            const { colour, offset } = SILVER_TEXT_SHADOW;
            text(value, cx, cy + offset, size, colour, 'bold', spacing);
        }
        text(value, cx, cy, size, SILVER_TEXT, 'bold', spacing);
    };

    function mark(cx, cy, angle, inner, outer, width, colour) {
        line(point(cx, cy, angle, inner), point(cx, cy, angle, outer), width, colour);
    }

    function needleTrail(trail, currentAngle) {
        for (const sample of trail.samples) {
            const age = (trail.now - sample.at) / TRAIL_LIFETIME_MS;
            const opacity = Math.pow(1 - age, 1.7);
            // Seed each group so its particles keep their positions as they fade.
            let seed = sample.at >>> 0;
            const random = () => {
                seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
                return seed / 4294967296;
            };
            for (let i = 0; i < 24; i++) {
                const spread = 3 + 23 * Math.pow(random(), 1.55) + age * 11;
                const angle = sample.angle - sample.direction * spread;
                const radius = 102 - 46 * Math.pow(random(), 1.65) - age * 5;
                const size = 0.37 + 0.51 * Math.pow(random(), 2);
                const alpha = Math.round((54 + 149 * random()) * opacity);
                if (!alpha || Math.abs(angle - currentAngle) > 50) continue;
                const [px, py] = point(480, CENTRE_Y, angle, radius);
                if (size > 0.65) disc(px, py, size * 2.5, [188, 201, 240, Math.round(alpha * 0.16)]);
                disc(px, py, size, [237, 242, 255, alpha]);
            }
        }
    }

    function sideFace(slot, defaultKind) {
        const cx = SILVER_SIDE_DIALS[slot];
        const left = slot === 'leftInner';
        const r = 96;
        const start = (left ? 90 : -90) + SIDE_BEZEL_GAP / 2;
        const end = start + 360 - SIDE_BEZEL_GAP;
        // Feather the face itself so the inward side has no dark circular seam.
        radialGlow(cx, SIDE_Y, r - 2, '#08090d', r - 20);
        radialGlow(cx, SIDE_Y, r - 4, palette.side + '54', r - 24);
        radialGlow(cx, SIDE_Y, r - 4, palette.rim + '4d');
        for (let band = 0; band < SIDE_BEZEL_GLOW.length; band++) {
            const outer = r + 1 + band;
            ring(cx, SIDE_Y, outer, outer + 1, start, end, '#d2d8e800', SIDE_BEZEL_GLOW[band]);
        }
        ring(cx, SIDE_Y, r - 5, r - 2, start, end, '#181b22',
            ['#42454e00', '#777c85', '#42454e', '#5a5f6a', '#42454e', '#777c85', '#42454e00']);
        ring(cx, SIDE_Y, r - 2, r + 1, start, end, CHROME, SIDE_BEZEL_RIM);

        if ((selections[slot] || defaultKind) !== defaultKind) return;
        const sign = left ? -1 : 1;
        for (let n = 0; n <= 42; n++) {
            const angle = sign * n * (180 / 42);
            const major = n % 21 === 0;
            mark(cx, SIDE_Y, angle, major ? 40 : 49, major ? 71 : 56, major ? 1.1 : 0.7,
                major ? '#b2b3bc' : '#525666');
        }
        text(left ? '8' : '100', cx, SIDE_Y - 68, 14, SILVER_TEXT, 'bold');
        text(left ? '4' : '50', cx + sign * 75, SIDE_Y + 5, 14, SILVER_TEXT, 'bold');
        text(left ? '0' : '0%', cx, SIDE_Y + 78, 13, SILVER_TEXT, 'bold');

        disc(cx, SIDE_Y, 10, '#050609');
    }

    function sideReading(slot, defaultKind, angle, readout, unit) {
        const cx = SILVER_SIDE_DIALS[slot];
        const left = slot === 'leftInner';
        const kind = selections[slot] || defaultKind;
        const custom = kind !== defaultKind;
        if (custom && opts.mapSlot !== slot) paintSlot(kind, cx, SIDE_Y);
        if (!custom && angle !== null && !(left && opts.nativeNeedles)) {
            paintSilverNeedle(canvas, x(cx), y(SIDE_Y), angle, scale, false);
        }
        const label = sideLabel(slot, custom);
        if (!left || !opts.nativeDigits) text(valueText(readout), label.x, label.y, label.size);
        text(unit, label.x, label.y + 17, 11, SILVER_TEXT, 'bold', 0.9);
    }

    const fuel = fraction(readings.fuelLitres, TANK_LITRES);
    const paintBackground = opts.paintBackground || ((paint) => paint());
    paintBackground(() => {
        sideFace('leftInner', 'rpm');
        sideFace('rightInner', 'fuelRange');
        const cx = SILVER_CENTRE[0];
        const { y: cy, radius } = SILVER_BEZEL;
        const faceRadius = radius - 8;
        const diameter = faceRadius * 2 * scale;
        disc(cx, cy, radius, '#2e3137');
        ring(cx, cy, radius - 2, radius, 0, 360, '#92949b', ['#9598a0', '#464951', '#252830', '#5f636b', '#9598a0']);
        ring(cx, cy, radius - 7, radius - 3, 0, 360, '#101217');
        canvas.card(x(cx - faceRadius), y(cy - faceRadius), diameter, diameter, diameter / 2,
            [[0, palette.upper], [0.24, palette.upper], [0.58, palette.mid], [1, palette.lower]]);
        ring(cx, cy, faceRadius - 2, faceRadius, 0, 360, '#5c6068', ['#4d4f57', '#696d79', '#454852', palette.rim, '#4d4f57']);

        for (let n = 0; n <= 84; n++) {
            const angle = -136 + (272 / 84) * n;
            const major = n % 14 === 0;
            mark(480, CENTRE_Y, angle, major ? 54 : 69, major ? 100 : 82,
                major ? 1.0 : 0.55, major ? centreMark : fineMark);
        }
        text('R', 477, CENTRE_Y - 37, 23);
        text('R', 483, CENTRE_Y - 31, 23);

        disc(480, CENTRE_Y, 18, palette.mid);
        disc(480, CENTRE_Y, 11, '#272729');
    });
    sideReading('leftInner', 'rpm', rpmAngle(readings.rpm), readings.rpm, 'RPM');
    sideReading('rightInner', 'fuelRange', fuel === null ? null : (1 - fuel) * 180, readings.range, 'KM RANGE');
    const speed = opts.demo && Number.isFinite(opts.previewSpeed) ? opts.previewSpeed : readings.speed;
    const angle = speedAngle(speed);
    if (angle !== null) {
        if (selections.needleEffect === 'starlight' && opts.needleTrail && !opts.nativeNeedles) needleTrail(opts.needleTrail, angle);
        if (!opts.nativeNeedles) paintSilverNeedle(canvas, x(480), y(CENTRE_Y), angle, scale, true, palette.lightFace);
    }
    const label = SILVER_SPEED_LABEL;
    if (!opts.nativeDigits) {
        const value = valueText(angle === null ? null : speed);
        speedText(value, label.x, label.y, fitBold(value, label.size, label.maxWidth));
    }
    speedText('KM/H', label.x, label.y + 16, 13, 1.1);

    const clock = opts.clock || (opts.demo ? DEMO.clock : '--:--');
    const statusY = 282;
    text(clock, 155, statusY, 19);
    text(Number.isFinite(readings.ambient) ? valueText(readings.ambient, 1) + '°C' : '--°C', 808, statusY, 19);
    const activeGear = readings.stage || readings.selection;
    const gearLabel = SILVER_GEAR_LABEL;
    ['P', 'R', 'N', 'D'].forEach((gear, index) => {
        const active = gear === activeGear;
        const baseline = gearLabel.firstBaseline + index * gearLabel.step;
        text(gear, gearLabel.x, baseline, gearLabel.size, SILVER_TEXT, active ? 'bold' : 'regular');
    });
}

module.exports = {
    silverDials, updateSilverTrail, paintSilverNeedle, speedAngle, rpmAngle, valueText, sideLabel,
    SILVER_SPEED_LABEL, SILVER_PALETTES, SILVER_TEXT, SILVER_TEXT_SHADOW, TANK_LITRES, TRAIL_LIFETIME_MS,
};
