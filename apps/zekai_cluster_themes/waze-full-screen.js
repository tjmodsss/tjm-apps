'use strict';

const { FONTS } = require('./instrument-type');

const MAP = {
    background: '#202a35',
    land: '#263540',
    park: '#304338',
    water: '#243d4a',
    minor: '#60707a',
    major: '#98a3a7',
    routeEdge: '#173a5b',
    route: '#70b8ff',
    ink: '#f4f7fb',
    muted: '#a9b8c7',
    bar: '#070d16e8',
    accent: '#72b9ff',
};

function wazeFullPanel(canvas, data, opts = {}) {
    const x = opts.x || 0;
    const y = opts.y || 0;
    const w = opts.w || 960;
    const h = opts.h || 360;
    const designH = opts.designH || 360;
    const sx = w / 960;
    const sy = h / designH;
    const unit = Math.min(sx, sy);
    const px = (v) => x + v * sx;
    const py = (v) => y + v * sy;
    const line = (x1, y1, x2, y2, width, colour) => canvas.line(px(x1), py(y1), px(x2), py(y2), width * unit, colour);
    const rect = (x1, y1, rw, rh, colour) => canvas.fillRect(px(x1), py(y1), rw * sx, rh * sy, colour);
    const round = (x1, y1, rw, rh, radius, colour) => canvas.roundRect(px(x1), py(y1), rw * sx, rh * sy, radius * unit, colour);
    const text = (value, cx, cy, size, colour = MAP.ink, align = 'center', weight = 'regular') =>
        canvas.text(String(value), px(cx), py(cy), size * unit, colour, {
            literal: true, align, font: FONTS[weight],
        });
    const polyline = (points, width, colour) => {
        for (let i = 1; i < points.length; i++) line(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1], width, colour);
    };

    if (opts.demo) drawMap();
    else if (!opts.active) {
        text('Waze map unavailable', 480, designH / 2, 20, MAP.muted);
    }

    // Transparent between these bars so the live Waze video stays visible.
    rect(0, 0, 960, 57, MAP.bar);
    rect(0, designH - 57, 960, 57, MAP.bar);
    rect(0, 56, 960, 1, '#ffffff30');
    rect(0, designH - 57, 960, 1, '#ffffff25');

    const clock = data.clock || '--:--';
    const ambient = Number.isFinite(data.ambient) ? Math.round(data.ambient) + '°' : '--°';
    const speed = Number.isFinite(data.speed) ? Math.round(data.speed) : '--';
    const gear = ['P', 'D', 'R', 'N'].includes(data.stage) ? data.stage : '--';
    text(clock, 31, 36, 20, MAP.ink, 'left', 'medium');
    text(ambient, 104, 36, 18, MAP.muted, 'left');
    text(speed, 480, 41, 35, MAP.ink, 'center', 'bold');
    text('km/h', 532, 40, 14, MAP.muted, 'left', 'medium');
    round(901, 10, 35, 37, 8, '#ffffff18');
    text(gear, 918, 36, 22, MAP.ink, 'center', 'bold');

    const range = Number.isFinite(data.range) ? Math.round(data.range) + ' km' : '-- km';
    const rpm = Number.isFinite(data.rpm) ? Math.round(data.rpm).toLocaleString('en-US') : '--';
    const coolant = Number.isFinite(data.coolant) ? Math.round(data.coolant) + '°' : '--°';
    const oil = Number.isFinite(data.oil) ? Math.round(data.oil) + '°' : '--°';
    const group = (cx, label, value, align = 'center') => {
        text(label, cx, designH - 36, 10, MAP.muted, align, 'medium');
        text(value, cx, designH - 13, 18, MAP.ink, align, 'medium');
    };
    group(156, 'RANGE', range);
    line(320, designH - 45, 320, designH - 11, 1, '#ffffff36');
    group(480, 'ENGINE RPM', rpm);
    line(641, designH - 45, 641, designH - 11, 1, '#ffffff36');
    text('COOLANT', 727, designH - 36, 10, MAP.muted, 'center', 'medium');
    text(coolant, 727, designH - 13, 18, MAP.ink, 'center', 'medium');
    text('OIL', 852, designH - 36, 10, MAP.muted, 'center', 'medium');
    text(oil, 852, designH - 13, 18, MAP.ink, 'center', 'medium');
    return canvas;

    function drawMap() {
        rect(0, 0, 960, designH, MAP.background);
        round(74, 112, 155, 92, 22, MAP.park);
        round(721, 82, 174, 109, 24, MAP.park);
        round(381, 166, 124, 59, 16, MAP.water);
        // A low contrast street grid keeps the route as the main visual focus.
        [
            [[-35, 83], [123, 93], [243, 87], [365, 103], [476, 94], [606, 104], [753, 90], [1010, 101]],
            [[-27, 226], [137, 220], [262, 231], [403, 216], [556, 227], [716, 213], [970, 226]],
            [[116, 45], [135, 115], [128, 191], [147, 281]],
            [[282, 48], [270, 116], [289, 177], [270, 271]],
            [[554, 44], [537, 113], [550, 185], [529, 275]],
            [[721, 40], [740, 111], [730, 180], [749, 283]],
            [[-14, 154], [178, 145], [338, 153], [511, 143], [699, 155], [982, 145]],
        ].forEach((road, i) => polyline(road, i < 2 ? 6 : 4, MAP.minor));
        // Main roads sit above the local grid.
        polyline([[-28, 47], [170, 60], [342, 50], [511, 65], [680, 52], [981, 67]], 10, MAP.major);
        polyline([[210, 342], [219, 254], [206, 176], [221, 91], [204, -20]], 9, MAP.major);
        polyline([[611, 334], [601, 246], [616, 171], [600, 94], [612, -15]], 8, MAP.major);
        // Navigation route with a dark keyline and a vivid Waze-like blue path.
        const route = [[474, 311], [455, 263], [452, 222], [474, 190], [523, 165], [557, 135], [568, 91], [623, 64], [691, 53]];
        polyline(route, 13, MAP.routeEdge);
        polyline(route, 7, MAP.route);
        text('E 12TH AVE', 350, 79, 10, '#c3cdd6', 'center', 'medium');
        text('KINGSWAY', 780, 123, 11, '#c3cdd6', 'center', 'medium');
        text('OAK ST', 155, 246, 10, '#c3cdd6', 'center', 'medium');
        // Current position marker.
        canvas.circle(px(474), py(222), 14 * unit, '#ffffff');
        canvas.circle(px(474), py(222), 10 * unit, MAP.accent);
        line(463, 230, 474, 207, 3, MAP.ink);
        line(474, 207, 485, 230, 3, MAP.ink);
    }
}

module.exports = { wazeFullPanel };
