'use strict';

const { Canvas } = require('./kit/canvas');
const { panel, porscheBatteryUsesCharge } = require('./dials');
const { PANEL_WIDTH, PANEL_HEIGHT, panelLayout, BMW_GEAR_WINDOW } = require('./panel-layout');
const { wazeFullPanel } = require('./waze-full-screen');
const { vdoPanel } = require('./vdo-retro');

function renderPanelFrame(theme, choices, data, demo = false, canvas = new Canvas(PANEL_WIDTH, PANEL_HEIGHT),
    faceCache, needleTrail, { nativeNeedles = false, nativeDigits = false } = {}) {
    const liveFullMap = theme === 'wazeFull' && data.mapSlot === 'fullMap';
    const base = liveFullMap ? '#00000000' : theme === 'vdoRetro' ? '#070809' : '#030507';
    const layout = panelLayout(theme);
    const resolutionScale = canvas.w / PANEL_WIDTH;
    if (theme === 'silver') {
        layout.x *= resolutionScale;
        layout.y *= resolutionScale;
        layout.scale *= resolutionScale;
    }
    if (!demo && faceCache && (theme === 'five' || theme === 'silver' || theme === 'vdoRetro')) {
        const chargeScale = theme === 'five' && Object.keys(choices).some((key) => choices[key] === 'battery') &&
            porscheBatteryUsesCharge(data);
        const faceKey = JSON.stringify([theme, choices, canvas.w, canvas.h, chargeScale]);
        layout.paintBackground = (paint) => {
            if (faceCache.key === faceKey) {
                canvas.d.set(faceCache.pixels);
                return;
            }
            canvas.clear(base);
            paint();
            faceCache.pixels = new Uint8Array(canvas.d);
            faceCache.key = faceKey;
        };
    } else canvas.clear(base);
    if (theme === 'wazeFull') {
        wazeFullPanel(canvas, data, { demo, active: liveFullMap, w: PANEL_WIDTH, h: PANEL_HEIGHT });
    } else if (theme === 'vdoRetro') {
        vdoPanel(canvas, data, Object.assign(layout, { demo }));
    } else {
        panel(canvas, theme, choices, data, Object.assign(layout, {
            demo, background: false, clock: data.clock, mapSlot: data.mapSlot, needleTrail, nativeNeedles, nativeDigits,
        }));
    }
    if (theme === 'silver' && !demo) {
        const { x, y, w, h } = BMW_GEAR_WINDOW;
        const left = Math.floor(x * resolutionScale);
        const right = Math.ceil((x + w) * resolutionScale);
        const top = Math.floor(y * resolutionScale);
        const bottom = Math.ceil((y + h) * resolutionScale);
        for (let row = top; row < bottom; row++) {
            canvas.d.fill(0, (row * canvas.w + left) * 4, (row * canvas.w + right) * 4);
        }
    }
    return canvas;
}

const MAX_FRAME_RECTS = 15;
const BAND_HEIGHT = 24;
const rectBytes = ({ w, h }) => 8 + w * h * 4;

function bounds(a, b) {
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

function mergeRects(rects) {
    // Spend the rectangle budget on the tightest coverage of moving pixels.
    // Joining across the unchanging space between dials can cost a full frame's worth of bandwidth.
    while (rects.length > MAX_FRAME_RECTS) {
        let best = Infinity, first = 0, second = 1;
        for (let i = 0; i < rects.length - 1; i++) {
            const a = rects[i];
            for (let j = i + 1; j < rects.length; j++) {
                const b = rects[j];
                const cost = rectBytes(bounds(a, b)) - rectBytes(a) - rectBytes(b);
                if (cost < best) {
                    best = cost;
                    first = i;
                    second = j;
                }
            }
        }
        rects[first] = bounds(rects[first], rects[second]);
        rects.splice(second, 1);
    }
}

function sendPanelFrame(client, ref, canvas, previous) {
    const pixels = Buffer.from(canvas.d.buffer);
    if (!previous) return client.pixels(ref, null, pixels);
    const lastPixels = Buffer.from(previous.d.buffer);
    const next = new Uint32Array(canvas.d.buffer);
    const last = new Uint32Array(previous.d.buffer);
    const rects = [];
    const width = canvas.w;

    function dirtyRect(left, right, top, bottom) {
        let x0 = right, x1 = left - 1, y0 = -1, y1 = -1;
        for (let y = top; y < bottom; y++) {
            const start = y * width;
            const byteStart = (start + left) * 4;
            const byteEnd = (start + right) * 4;
            if (pixels.compare(lastPixels, byteStart, byteEnd, byteStart, byteEnd) === 0) continue;
            if (y0 < 0) y0 = y;
            y1 = y;
            for (let x = left; x < x0; x++) {
                if (next[start + x] !== last[start + x]) { x0 = x; break; }
            }
            for (let x = right - 1; x > x1; x--) {
                if (next[start + x] !== last[start + x]) { x1 = x; break; }
            }
        }
        return y0 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
    }

    const cuts = [0, Math.floor(width / 3), Math.floor(width * 2 / 3), width];
    for (let top = 0; top < canvas.h; top += BAND_HEIGHT) {
        const bottom = Math.min(top + BAND_HEIGHT, canvas.h);
        if (pixels.compare(lastPixels, top * width * 4, bottom * width * 4, top * width * 4, bottom * width * 4) === 0) continue;
        for (let column = 0; column < cuts.length - 1; column++) {
            const rect = dirtyRect(cuts[column], cuts[column + 1], top, bottom);
            if (rect) rects.push(rect);
        }
    }
    if (!rects.length) return true;
    mergeRects(rects);
    if (rects.reduce((sum, rect) => sum + rectBytes(rect), 0) >= pixels.length) {
        return client.pixels(ref, null, pixels);
    }
    const rows = [];
    for (const rect of rects) {
        for (let y = rect.y; y < rect.y + rect.h; y++) {
            const start = (y * width + rect.x) * 4;
            rows.push(pixels.slice(start, start + rect.w * 4));
        }
    }
    return client.pixels(ref, rects, Buffer.concat(rows));
}

module.exports = { renderPanelFrame, sendPanelFrame };
