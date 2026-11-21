'use strict';

const { Canvas } = require('./kit/canvas');

class RotatingNeedles {
    constructor(client, layout) {
        this.client = client;
        this.layout = layout;
        this.layers = [];
    }

    addSprite(cx, cy, { px, py, w, h }, paint) {
        const { x, y, scale } = this.layout;
        const canvas = new Canvas(w, h);
        paint(canvas, px, py, scale);
        const ref = this.client.image({
            target: 'panel', klass: 'overlay', z: 1, x: Math.round(x + cx * scale) - px,
            y: Math.round(y + cy * scale) - py, w, h, iw: w, ih: h, px, py,
            visible: false, sampling: 'bilinear',
        });
        if (!ref) return false;
        this.layers.push({ ref, angle: null });
        return this.client.pixels(ref, null, Buffer.from(canvas.d.buffer));
    }

    move(angles, shown) {
        for (let i = 0; i < this.layers.length; i++) {
            const layer = this.layers[i];
            const angle = shown ? angles[i] : null;
            if (angle === layer.angle) continue;
            this.client.set(layer.ref, angle === null ? { visible: false } : { visible: true, rotate: angle });
            layer.angle = angle;
        }
    }

    owns(ref) { return this.layers.some((layer) => layer.ref === ref); }

    drop() {
        for (const { ref } of this.layers) this.client.drop(ref);
        this.layers = [];
    }
}

module.exports = { RotatingNeedles };
