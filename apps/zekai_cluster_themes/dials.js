'use strict';

const { silverDials } = require('./silver-dials');
const { instrumentType } = require('./instrument-type');
const { SILVER_SIDE_DIALS } = require('./panel-layout');

const INK = '#eef4ff';
const SOFT = '#acbbd5';
const DARK = '#05080f';
const DEFAULT_FULL_RANGE_KM = 800;
const PALETTES = {
    navy: { rim: '#9eadd1', edge: '#425274', face: '#060910', glow: '#0c1322', ring: '#1b2843' },
    blue: { rim: '#9bb6df', edge: '#293d5c', face: '#112037', glow: '#2e4b72', ring: '#314e78' },
    teal: { rim: '#94bdc5', edge: '#21424a', face: '#08252a', glow: '#175458', ring: '#1d595c' },
    magenta: { rim: '#c7a3ce', edge: '#4f264f', face: '#32112f', glow: '#982269', ring: '#9b2472' },
    red: { rim: '#bdafb8', edge: '#3c343e', face: '#080910', glow: '#14121b', ring: '#ca234c' },
};
const SLOTS = ['leftOuter', 'leftInner', 'rightInner', 'rightOuter'];
const SILVER_SLOTS = Object.keys(SILVER_SIDE_DIALS);
const NAMES = {
    coolant: 'Coolant', oil: 'Engine oil', ambient: 'Outside temperature', range: 'Fuel range',
    clock: 'Clock', tyres: 'Tyre pressures', temps: 'Oil and coolant',
    media: 'Now playing', waze: 'Waze', none: 'Blank', rpm: 'Engine RPM', fuelRange: 'Fuel & range',
};
const SHORT = { coolant: 'COOLANT', oil: 'OIL', ambient: 'OUTSIDE', range: 'RANGE' };
const MAP_ROADS = [
    [[-90, 14], [-53, -18], [-29, -22], [9, -44], [63, -51], [92, -70]],
    [[-93, -29], [-58, -43], [-19, -65], [29, -81]],
    [[-53, 90], [-37, 55], [-36, 17], [-14, -20], [5, -80]],
    [[65, 91], [42, 62], [39, 19], [64, -15], [93, -24]],
    [[-89, 47], [-43, 41], [-11, 21], [42, 19], [91, -1]],
    [[20, 95], [7, 43], [8, 14], [25, -29], [47, -56]],
    [[-61, -12], [-19, 2], [27, -19], [88, -10]],
];
const MAP_ROUTE = [[-19, 90], [-2, 43], [-3, 9], [7, -5], [46, -19], [68, -56]];
const DEMO = {
    speed: 0, rpm: 0, coolant: 19, oil: 20, ambient: 15, range: 418,
    pressureUnit: 'bar', tyres: [2.4, 2.4, 2.6, 2.6],
};

function number(value, decimals = 0) {
    return Number.isFinite(value) ? value.toFixed(decimals) : '--';
}

function circleSegment(a, b, radius) {
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
    const length = dx * dx + dy * dy;
    if (!length) return null;
    const p = (a[0] * dx + a[1] * dy) / length;
    const discriminant = p * p + (radius * radius - a[0] * a[0] - a[1] * a[1]) / length;
    if (discriminant <= 0) return null;
    const bound = Math.sqrt(discriminant);
    const start = Math.max(0, -p - bound);
    const end = Math.min(1, -p + bound);
    return start < end ? [[a[0] + dx * start, a[1] + dy * start], [a[0] + dx * end, a[1] + dy * end]] : null;
}

function panel(canvas, theme, selections, data, opts) {
    const demo = Boolean(opts.demo);
    const palette = PALETTES[selections.faceColour] || PALETTES.navy;
    const scale = opts.scale || 1;
    const ox = opts.x || 0;
    const oy = opts.y || 0;
    const x = (v) => ox + v * scale;
    const y = (v) => oy + v * scale;
    if (opts.background !== false) canvas.fillRect(x(0), y(0), 960 * scale, 320 * scale, '#030507');
    const arc = (cx, cy, r0, r1, a0, a1, color, style) =>
        canvas.arc(x(cx), y(cy), r0 * scale, r1 * scale, a0, a1, color, style);
    const disc = (cx, cy, r, color) => canvas.circle(x(cx), y(cy), r * scale, color);
    const box = (lx, ly, w, h, r, color) => canvas.roundRect(x(lx), y(ly), w * scale, h * scale, r * scale, color);
    const line = (ax, ay, bx, by, width, color) =>
        canvas.line(x(ax), y(ay), x(bx), y(by), width * scale, color);
    const { text, measure, fitBold } = instrumentType(canvas, x, y, scale, INK, theme === 'five' ? 0.9 : 1);
    const quad = (pts, color) => canvas.quad(pts.map(([px, py]) => [x(px), y(py)]), color);
    const trace = (pts, width, color) => {
        for (let i = 1; i < pts.length; i++) line(...pts[i - 1], ...pts[i], width, color);
    };
    const frame = (cx, cy, radius) => {
        disc(cx, cy, radius, palette.edge);
        arc(cx, cy, radius - 2.7, radius, 0, 360, palette.rim, {
            ramp: ['#e0e8fa', palette.rim, palette.edge, palette.rim, '#e0e8fa'],
        });
        arc(cx, cy, 0, radius - 3.2, 0, 360, palette.face, {
            ramp: [palette.face, palette.face, palette.glow, palette.face, palette.face],
        });
        arc(cx, cy, radius - 5.6, radius - 4.5, 0, 360, palette.edge);
    };
    const labels = (cx, cy, label, value, size = 25) => {
        text(value, cx, cy + 4, size);
        text(label, cx, cy + 24, 12, SOFT, 'medium');
    };
    const temperature = (kind, cx, cy) => {
        const k = cy - 26;
        if (kind === 'coolant') {
            arc(cx - 3, k + 10, 3.5, 5, 45, 315, INK);
            trace([[cx - 6, k + 7], [cx - 6, k - 4], [cx - 4, k - 6], [cx - 2, k - 4], [cx - 2, k + 7]], 1.5, INK);
            line(cx - 4, k + 9, cx - 4, k + 3, 1.6, INK);
            line(cx + 1, k - 1, cx + 6, k - 1, 1.4, INK);
            line(cx + 1, k + 3, cx + 4, k + 3, 1.4, INK);
        } else {
            trace([[cx - 13, k + 1], [cx - 6, k + 3], [cx - 4, k], [cx + 5, k], [cx + 8, k + 3], [cx + 13, k], [cx + 14, k + 3], [cx + 6, k + 9], [cx - 7, k + 9], [cx - 13, k + 1]], 1.5, INK);
            line(cx, k, cx, k - 5, 1.5, INK);
            line(cx - 4, k - 5, cx + 4, k - 5, 1.5, INK);
            disc(cx + 13, k + 11, 2, INK);
        }
        text(number(data[kind]) + '°C', cx, cy + 19, 30, INK, 'bold');
        text(kind === 'oil' ? 'OIL TEMP' : 'COOLANT', cx, cy + 39, 12, SOFT, 'bold', 0.9);
    };
    const demoCover = (cx, cy) => {
        canvas.card(x(cx - 44), y(cy - 56), 88 * scale, 88 * scale, 6 * scale,
            [[0, '#ad525e'], [0.47, '#df9174'], [1, '#363054']]);
        disc(cx + 10, cy - 26, 15, '#ffd3a8');
        const hills = (pts, base, color) => {
            canvas.fillUnder(pts.map(([px, py]) => [x(cx + px), y(cy + py)]), y(cy + base), color);
        };
        hills([[-44, 14], [-20, -20], [5, 3], [23, -13], [44, 15]], 26, '#563a52');
        hills([[-44, 19], [-20, 0], [1, 17], [17, 10], [44, 20]], 28, '#262a43');
        box(cx - 43, cy + 26, 86, 4, 2, '#1a2036');
        text('Night Drive', cx, cy + 55, 20, INK, 'bold');
        text('The Midnight', cx, cy + 70, 13, SOFT);
    };
    const demoMap = (cx, cy) => {
        disc(cx, cy, 79, '#101a26');
        const strokes = (points, width, colour) => {
            for (let i = 1; i < points.length; i++) {
                const segment = circleSegment(points[i - 1], points[i], 76 - width / 2);
                if (segment) {
                    const [[ax, ay], [bx, by]] = segment;
                    line(cx + ax, cy + ay, cx + bx, cy + by, width, colour);
                }
            }
        };
        for (const road of MAP_ROADS) strokes(road, 1.8, '#3b4b5c');
        strokes(MAP_ROUTE, 8, '#172440');
        strokes(MAP_ROUTE, 4.9, '#a2bbff');
        quad([[cx - 3, cy + 19], [cx + 6, cy + 39], [cx - 3, cy + 35], [cx - 12, cy + 39]], '#407bd0');
        quad([[cx - 3, cy + 23], [cx + 3, cy + 36], [cx - 3, cy + 33], [cx - 9, cy + 36]], '#e7f1ff');
        box(cx - 49, cy - 67, 98, 29, 6, '#455e7b');
        box(cx - 48, cy - 66, 96, 27, 5, '#1c3147');
        trace([[cx - 33, cy - 46], [cx - 33, cy - 55], [cx - 21, cy - 55]], 1.6, INK);
        trace([[cx - 25, cy - 59], [cx - 21, cy - 55], [cx - 25, cy - 51]], 1.6, INK);
        text('350 m', cx + 9, cy - 47, 16, INK, 'bold');
        box(cx - 32, cy + 55, 64, 19, 4, '#172333');
        text('WAZE', cx, cy + 69, 11, INK, 'bold', 0.9);
    };
    const mediaLine = (value, size, weight) => {
        if (measure(value, size, weight) <= 128) return value;
        const characters = Array.from(value);
        let lo = 0;
        let hi = characters.length;
        while (lo < hi) {
            const count = Math.ceil((lo + hi) / 2);
            const candidate = characters.slice(0, count).join('') + '...';
            if (measure(candidate, size, weight) <= 128) lo = count;
            else hi = count - 1;
        }
        return characters.slice(0, lo).join('').trim() + '...';
    };
    const paintSlot = (kind, cx, cy) => {
        if (kind === 'none') return;
        if (kind === 'clock') return labels(cx, cy, 'TIME', opts.clock || '--:--');
        if (theme === 'five' && (kind === 'oil' || kind === 'coolant')) return temperature(kind, cx, cy);
        if (SHORT[kind]) {
            const unit = kind === 'range' ? ' km' : '°C';
            return labels(cx, cy, SHORT[kind], number(data[kind]) + unit, kind === 'range' ? 21 : 25);
        }
        if (kind === 'temps') {
            labels(cx, cy - 24, 'OIL', number(data.oil) + '°C', 20);
            return labels(cx, cy + 25, 'COOLANT', number(data.coolant) + '°C', 20);
        }
        if (kind === 'tyres') {
            const tyres = data.pressureUnit && data.tyres || [];
            for (let i = 0; i < 4; i++) {
                const dx = i % 2 === 0 ? -29 : 29;
                const dy = i < 2 ? -15 : 21;
                text(number(tyres[i], data.pressureUnit === 'bar' ? 1 : 0), cx + dx, cy + dy, 18);
            }
            return text(data.pressureUnit || 'TYRES', cx, cy + 45, 12, SOFT);
        }
        if (kind === 'waze' && !demo) return paintSlot(selections.fallback, cx, cy);
        if (kind === 'media') {
            if (demo) return demoCover(cx, cy);
            box(cx - 25, cy - 44, 50, 50, 5, '#1a2435');
            disc(cx - 6, cy - 13, 5, INK);
            line(cx - 2, cy - 13, cx - 2, cy - 32, 3, INK);
            line(cx - 2, cy - 32, cx + 10, cy - 27, 3, INK);
            const media = data.media;
            if (media && media.title) {
                text(mediaLine(media.title, 16, 'bold'), cx, cy + 28, 16, INK, 'bold');
                return text(mediaLine(media.artist || '', 13, 'regular'), cx, cy + 47, 13, SOFT);
            }
            text('NOW PLAYING', cx, cy + 28, 14, INK, 'bold');
            return text('No track data', cx, cy + 47, 12, SOFT);
        }
        if (kind === 'waze') return demoMap(cx, cy);
    };

    if (theme === 'silver') return silverDials(canvas, data, opts, selections, paintSlot);

    if (theme === 'stock') {
        text('BMW original', 480, 156, 38);
        text('Factory instrument display', 480, 195, 19, SOFT);
        return;
    }

    if (theme === 'digital') {
        const positions = [[164, 174, 55], [306, 164, 77], [654, 164, 77], [796, 174, 55]];
        for (let index = 0; index < SLOTS.length; index++) {
            const [cx, cy, radius] = positions[index];
            const kind = selections[SLOTS[index]];
            if (kind === 'none') continue;
            box(cx - radius, cy - radius, radius * 2, radius * 2, 14, '#101a29');
            if (opts.mapSlot !== SLOTS[index]) paintSlot(kind, cx, cy);
        }
        const speed = number(data.speed);
        text(speed, 480, 174, fitBold(speed, 77, 174), INK, 'bold');
        text('km/h', 480, 201, 20, SOFT, 'medium');
        const rpm = Number.isFinite(data.rpm) ? Math.max(0, Math.min(1, data.rpm / 8000)) : 0;
        box(390, 223, 180, 5, 2, '#243246');
        if (rpm > 0) box(390, 223, 180 * rpm, 5, 2, '#accfff');
        text(number(data.rpm) + ' RPM', 480, 249, 16, SOFT);
        return;
    }

    const positions = [[164, 181, 64], [306, 171, 86], [654, 171, 86], [796, 181, 64]];
    const lowSpeed = selections.speedPosition === 'lower';
    const centreX = 480;
    const centreY = 168;
    const polar = (a, r) => [centreX + Math.cos(a * Math.PI / 180) * r, centreY + Math.sin(a * Math.PI / 180) * r];
    const paintBackground = opts.paintBackground || ((paint) => paint());
    paintBackground(() => {
        [0, 3, 1, 2].forEach((index) => frame(...positions[index]));
        frame(centreX, centreY, 112);
        arc(centreX, centreY, 64, 106, 0, 360, palette.ring, {
            ramp: [palette.ring, palette.ring, palette.edge, palette.ring, palette.ring],
        });
        const stripe = (offset, begin, end) => {
            const p = (d) => [centreX + 0.8 * offset + 0.6 * d, centreY + 0.6 * offset - 0.8 * d];
            line(...p(begin), ...p(end), 0.65, '#a2b6df22');
        };
        for (let offset = -104; offset <= 104; offset += 3.7) {
            const reach = Math.sqrt(105 * 105 - offset * offset);
            const gap = Math.sqrt(Math.max(0, 65 * 65 - offset * offset));
            if (gap) {
                stripe(offset, -reach, -gap);
                stripe(offset, gap, reach);
            } else stripe(offset, -reach, reach);
        }
        if (selections.faceColour === 'red') {
            for (let radius = 67; radius < 105; radius += 3) {
                arc(centreX, centreY, radius, radius + 0.7, 0, 360, '#f24e7288');
            }
        }
        arc(centreX, centreY, 105, 107, 235, 485, '#8a9abe');
        arc(centreX, centreY, 101, 106, 447, 485, '#e65065', { round: true });
        disc(centreX, centreY, 65, '#7283aa');
        disc(centreX, centreY, 63, lowSpeed ? palette.face : '#05070b');
        for (let i = 0; i <= 40; i++) {
            const major = i % 5 === 0;
            const angle = 145 + i * 6.25;
            const [ax, ay] = polar(angle, 105);
            const [bx, by] = polar(angle, major ? 97 : 100);
            line(ax, ay, bx, by, major ? 1.8 : 0.7, major ? INK : SOFT);
            if (major) {
                const [cx, cy] = polar(angle, 84);
                text(String(i / 5), cx, cy + 6, 20, INK, 'bold');
            }
        }
    });
    positions.forEach(([cx, cy], index) => {
        if (opts.mapSlot !== SLOTS[index]) paintSlot(selections[SLOTS[index]], cx, cy);
    });
    if (Number.isFinite(data.rpm)) {
        const angle = 145 + 250 * Math.max(0, Math.min(1, data.rpm / 8000));
        const [ax, ay] = polar(angle, lowSpeed ? -18 : 65);
        const [bx, by] = polar(angle, 103);
        line(ax, ay, bx, by, 5.2, '#121a2d');
        line(ax, ay, bx, by, 3.1, '#f5f7ff');
    }
    const speed = number(data.speed);
    if (lowSpeed) {
        disc(centreX, centreY, 10, '#1d283b');
        disc(centreX, centreY, 7.5, '#657795');
        disc(centreX - 1, centreY - 1, 4, '#9aa9c1');
        text('RPM x 1000', centreX, 136, 12, SOFT, 'bold');
        text(speed, centreX, 214, fitBold(speed, 44, 80), INK, 'bold');
    } else {
        text(speed, centreX, 178, fitBold(speed, 62, 106), INK, 'bold');
    }
    text('km/h', centreX, lowSpeed ? 226 : 204, 10, INK, 'medium');
    const rangeArcRadius = 98;
    text(number(data.range) + ' km', centreX, centreY + rangeArcRadius - 7, 17, INK, 'medium');
    const fullRange = Number(selections.fullRangeKm) || DEFAULT_FULL_RANGE_KM;
    const fill = Number.isFinite(data.range) ? Math.max(0, Math.min(1, data.range / fullRange)) : 0;
    arc(centreX, centreY, rangeArcRadius, 101, 157, 203, '#586783');
    if (fill > 0) {
        arc(centreX, centreY, rangeArcRadius, 101, 203 - 46 * fill, 203, '#dce7ff');
    }
}

module.exports = { panel, SLOTS, SILVER_SLOTS, NAMES, DEMO, PALETTES };
