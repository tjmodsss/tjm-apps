'use strict';

const MAX_BYTES = 850000;
const SIDE = 128;

function identity(value) {
    if (value === undefined || value === null) return null;
    if (typeof value === 'string' || Number.isSafeInteger(value) || typeof value === 'bigint') return String(value);
    if (Number.isInteger(value.high) && Number.isInteger(value.low)) return value.high + ':' + value.low;
    return null;
}

function trackKey(value) {
    if (!value) return null;
    const track = identity(value.trackId);
    return track === null ? null : JSON.stringify([identity(value.menuEntry), track]);
}

function front(value) {
    return !value || value.sink === undefined || value.sink === 0 || value.sink === 'FRONT';
}

function toSquare({ w, h, data }) {
    const size = Math.min(w, h);
    if (!size) return null;
    const pixels = Buffer.alloc(SIDE * SIDE * 4);
    const x = Math.floor((w - size) / 2);
    const y = Math.floor((h - size) / 2);
    for (let row = 0; row < SIDE; row++) {
        for (let col = 0; col < SIDE; col++) {
            const index = ((y + Math.floor((row + 0.5) * size / SIDE)) * w + x +
                Math.floor((col + 0.5) * size / SIDE)) * 4;
            const dest = (row * SIDE + col) * 4;
            for (let channel = 0; channel < 3; channel++) {
                pixels[dest + channel] = Math.round(data[index + channel] * data[index + 3] / 255);
            }
            pixels[dest + 3] = 255;
        }
    }
    return { pixels, side: SIDE };
}

function decodeArtwork(bytes) {
    if (!bytes.length || bytes.length > MAX_BYTES) return Promise.resolve(null);
    if (bytes[0] === 0xff && bytes[1] === 0xd8) {
        return Promise.resolve().then(() => {
            const jpeg = require('./jpeg-decoder');
            const image = jpeg(bytes, { useTArray: true, maxResolutionInMP: 2, maxMemoryUsageInMB: 24 });
            return toSquare({ w: image.width, h: image.height, data: image.data });
        }).catch(() => null);
    }
    return new Promise((resolve) => {
        try { require('./kit/png').decodeAsync(bytes, (error, image) => resolve(error ? null : toSquare(image))); }
        catch (error) { resolve(null); }
    });
}

class MediaArtwork {
    constructor() {
        this.current = null;
        this.revision = 0;
    }

    receive(value) {
        if (!value || !front(value)) return;
        const track = trackKey(value);
        if (track === null) return;
        const { coverArt, totalSize, offset } = value;
        if (totalSize === 0) {
            if (this.current && this.current.track === track) this.current = null;
            return;
        }
        if (!coverArt || !(Array.isArray(coverArt) || coverArt instanceof Uint8Array) ||
            !Number.isInteger(totalSize) || totalSize < 1 || totalSize > MAX_BYTES ||
            !coverArt.length || !Number.isInteger(offset) || offset < 0 || offset + coverArt.length > totalSize) return;
        const id = JSON.stringify([track, identity(value.coverArtId), totalSize]);
        let cover = this.current;
        if (!cover || cover.id !== id) {
            cover = { id, track, chunks: new Map(), received: 0, artwork: null, complete: false };
            this.current = cover;
        }
        if (cover.complete || cover.chunks.has(offset)) return;
        if (cover.chunks.size >= 128) {
            this.current = null;
            return;
        }
        cover.chunks.set(offset, Buffer.from(coverArt));
        cover.received += coverArt.length;
        if (cover.received < totalSize) return;
        let next = 0;
        const chunks = Array.from(cover.chunks).sort(([a], [b]) => a - b);
        for (const [start, bytes] of chunks) {
            if (start !== next) {
                this.current = null;
                return;
            }
            next += bytes.length;
        }
        cover.complete = true;
        cover.chunks.clear();
        return decodeArtwork(Buffer.concat(chunks.map(([, bytes]) => bytes), next)).then((artwork) => {
            if (this.current !== cover || !artwork) return;
            cover.artwork = artwork;
            cover.revision = ++this.revision;
        });
    }

    get(track) {
        const cover = this.current;
        return cover && cover.track === track && cover.artwork ? cover : null;
    }
}

function withArtwork(track, cover, origin = 'car') {
    if (!cover) return track;
    const output = Object.assign({}, track, { coverRevision: origin + ':' + cover.revision });
    Object.defineProperty(output, 'artwork', { value: cover.artwork });
    return output;
}

module.exports = { MediaArtwork, trackKey, front, decodeArtwork, withArtwork };
