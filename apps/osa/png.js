'use strict';
const fs = require('fs');
const zlib = require('zlib');
const { Canvas } = require('./kit/canvas');

// Decode non-interlaced 8-bit PNGs (indexed, RGB or RGBA) into the MGU canvas.
function decode(file, outW, outH) {
    const b = fs.readFileSync(file);
    if (b.toString('hex', 0, 8) !== '89504e470d0a1a0a') throw new Error('Invalid PNG');
    let w = 0, h = 0, depth = 0, type = 0, interlace = 0, palette = null, alpha = null;
    const idat = [];
    for (let p = 8; p < b.length;) {
        const len = b.readUInt32BE(p), name = b.toString('ascii', p + 4, p + 8);
        const data = b.subarray(p + 8, p + 8 + len);
        if (name === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; type = data[9]; interlace = data[12]; }
        else if (name === 'PLTE') palette = data;
        else if (name === 'tRNS') alpha = data;
        else if (name === 'IDAT') idat.push(data);
        else if (name === 'IEND') break;
        p += len + 12;
    }
    const bpp = type === 6 ? 4 : type === 2 ? 3 : type === 3 ? 1 : 0;
    if (depth !== 8 || !bpp || interlace !== 0 || (type === 3 && !palette)) {
        throw new Error('Unsupported PNG format (expected 8-bit indexed/RGB/RGBA)');
    }
    const stride = w * bpp, raw = zlib.inflateSync(Buffer.concat(idat));
    let prev = Buffer.alloc(stride), pos = 0;
    const pixels = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) {
        const filter = raw[pos++], row = Buffer.from(raw.subarray(pos, pos + stride)); pos += stride;
        for (let x = 0; x < stride; x++) {
            const a = x >= bpp ? row[x - bpp] : 0, up = prev[x], ul = x >= bpp ? prev[x - bpp] : 0;
            if (filter === 1) row[x] = (row[x] + a) & 255;
            else if (filter === 2) row[x] = (row[x] + up) & 255;
            else if (filter === 3) row[x] = (row[x] + Math.floor((a + up) / 2)) & 255;
            else if (filter === 4) {
                const q = a + up - ul, pa = Math.abs(q - a), pb = Math.abs(q - up), pc = Math.abs(q - ul);
                row[x] = (row[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? up : ul)) & 255;
            } else if (filter !== 0) throw new Error('Unsupported PNG filter');
        }
        for (let x = 0; x < w; x++) {
            const si = x * bpp, di = (y * w + x) * 4;
            if (type === 6) {
                pixels[di] = row[si]; pixels[di + 1] = row[si + 1];
                pixels[di + 2] = row[si + 2]; pixels[di + 3] = row[si + 3];
            } else if (type === 2) {
                pixels[di] = row[si]; pixels[di + 1] = row[si + 1];
                pixels[di + 2] = row[si + 2]; pixels[di + 3] = 255;
            } else {
                const idx = row[si], pi = idx * 3;
                pixels[di] = palette[pi]; pixels[di + 1] = palette[pi + 1];
                pixels[di + 2] = palette[pi + 2];
                pixels[di + 3] = alpha && idx < alpha.length ? alpha[idx] : 255;
            }
        }
        row.copy(prev);
    }
    const cw = outW || w, ch = outH || h, cv = new Canvas(cw, ch);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
        const si = (Math.min(h - 1, Math.floor(y * h / ch)) * w + Math.min(w - 1, Math.floor(x * w / cw))) * 4;
        const di = (y * cw + x) * 4;
        cv.d[di] = pixels[si]; cv.d[di + 1] = pixels[si + 1];
        cv.d[di + 2] = pixels[si + 2]; cv.d[di + 3] = pixels[si + 3];
    }
    return cv;
}
module.exports = { decode };
