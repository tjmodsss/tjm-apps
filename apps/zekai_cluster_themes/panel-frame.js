'use strict';

const { Canvas } = require('./kit/canvas');
const { panel } = require('./dials');
const { PANEL_WIDTH, PANEL_HEIGHT, panelLayout } = require('./panel-layout');
const { wazeFullPanel } = require('./waze-full-screen');
const { vdoPanel } = require('./vdo-retro');

function renderPanelFrame(theme, choices, data, demo = false, canvas = new Canvas(PANEL_WIDTH, PANEL_HEIGHT), faceCache) {
    const liveFullMap = theme === 'wazeFull' && data.mapSlot === 'fullMap';
    const base = liveFullMap ? '#00000000' : theme === 'vdoRetro' ? '#070809' : '#030507';
    const layout = panelLayout(theme);
    if (!demo && faceCache && (theme === 'five' || theme === 'silver' || theme === 'vdoRetro')) {
        const faceKey = JSON.stringify([theme, choices, canvas.w, canvas.h]);
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
            demo, background: false, clock: data.clock, mapSlot: data.mapSlot,
        }));
    }
    // In a side dial, the compatible Waze provider draws its map above
    // this image. Keep the face opaque if the provider stops drawing.
    return canvas;
}

const MAX_FRAME_RECTS = 15;
const BAND_HEIGHT = 48;

function sendPanelFrame(client, ref, canvas, previous) {
    const pixels = Buffer.from(canvas.d.buffer);
    if (!previous) return client.pixels(ref, null, pixels);
    const lastPixels = Buffer.from(previous.d.buffer);
    const next = new Uint32Array(canvas.d.buffer);
    const last = new Uint32Array(previous.d.buffer);
    const bands = [];
    const rows = [];
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

    const bytes = (rect) => 8 + rect.w * rect.h * 4;
    const cuts = [0, Math.floor(width / 3), Math.floor(width * 2 / 3), width];
    // Split bands around separated dials when the saved pixels justify the extra rectangles.
    for (let top = 0; top < canvas.h; top += BAND_HEIGHT) {
        const bottom = Math.min(top + BAND_HEIGHT, canvas.h);
        if (pixels.compare(lastPixels, top * width * 4, bottom * width * 4, top * width * 4, bottom * width * 4) === 0) continue;
        const parts = [];
        for (let column = 0; column < cuts.length - 1; column++) {
            const rect = dirtyRect(cuts[column], cuts[column + 1], top, bottom);
            if (rect) parts.push(rect);
        }
        const left = parts[0].x;
        const right = parts[parts.length - 1].x + parts[parts.length - 1].w;
        const y = Math.min(...parts.map((r) => r.y));
        const h = Math.max(...parts.map((r) => r.y + r.h)) - y;
        const combined = { x: left, y, w: right - left, h };
        const savings = bytes(combined) - parts.reduce((sum, rect) => sum + bytes(rect), 0);
        bands.push({ rects: [combined], parts, savings });
    }

    let remaining = MAX_FRAME_RECTS - bands.length;
    for (const band of bands.slice().sort((a, b) => b.savings - a.savings)) {
        const extra = band.parts.length - 1;
        if (band.savings <= 0 || extra > remaining) continue;
        band.rects = band.parts;
        remaining -= extra;
    }
    const rects = [];
    for (const band of bands) {
        for (const rect of band.rects) {
            rects.push(rect);
            for (let y = rect.y; y < rect.y + rect.h; y++) {
                const start = (y * width + rect.x) * 4;
                rows.push(pixels.slice(start, start + rect.w * 4));
            }
        }
    }
    return !rects.length || client.pixels(ref, rects, Buffer.concat(rows));
}

module.exports = { renderPanelFrame, sendPanelFrame };
