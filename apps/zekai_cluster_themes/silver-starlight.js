'use strict';

const { Canvas } = require('./kit/canvas');
const { panelLayout, SILVER_CENTRE } = require('./panel-layout');
const { updateSilverTrail, TRAIL_LIFETIME_MS } = require('./silver-dials');

const STAMP = { x: -48, y: -108, w: 56, h: 71 };
const MAX_STAMPS = 6;
const SHADER = [
    'precision mediump float;',
    'varying vec2 v_uv;',
    'uniform sampler2D u_stars;',
    'uniform vec2 u_fade;', // opacity, horizontal direction
    'void main() {',
    '    float x = u_fade.y < 0.0 ? 1.0 - v_uv.x : v_uv.x;',
    '    vec4 stars = texture2D(u_stars, vec2(x, v_uv.y));',
    '    gl_FragColor = vec4(stars.rgb, stars.a * u_fade.x);',
    '}',
].join('\n');

function starImage(scale) {
    const canvas = new Canvas(Math.ceil(STAMP.w * scale), Math.ceil(STAMP.h * scale));
    let state = 17323;
    const rand = () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 4294967296;
    };
    for (let i = 0; i < 24; i++) {
        const angle = -(3 + 23 * rand() ** 1.55) * Math.PI / 180;
        const radius = 102 - 46 * rand() ** 1.65;
        const size = (0.37 + 0.51 * rand() ** 2) * scale;
        const alpha = Math.round(54 + 149 * rand());
        const x = (Math.sin(angle) * radius - STAMP.x) * scale;
        const y = (-Math.cos(angle) * radius - STAMP.y) * scale;
        if (size > 0.65 * scale) canvas.circle(x, y, size * 2.5, [188, 201, 240, Math.round(alpha * 0.16)]);
        canvas.circle(x, y, size, [237, 242, 255, alpha]);
    }
    return canvas;
}

class SilverStarlight {
    constructor(client) {
        this.client = client;
        this.layers = [];
        this.trail = {};
        this.asset = null;
    }

    prepare() {
        const { x, y, scale } = panelLayout('silver');
        const canvas = starImage(scale);
        this.geometry = { scale, x: x + SILVER_CENTRE[0] * scale, y: y + SILVER_CENTRE[1] * scale, w: canvas.w, h: canvas.h };
        this.asset = this.client.asset({ target: 'panel', w: canvas.w, h: canvas.h, sampling: 'bilinear' });
        if (!this.asset || !this.client.pixels(this.asset, null, Buffer.from(canvas.d.buffer))) return false;
        for (let i = 0; i < MAX_STAMPS; i++) {
            const ref = this.client.effect({
                target: 'panel', klass: 'overlay', z: 0, w: canvas.w, h: canvas.h,
                visible: false, fs: SHADER,
            });
            if (!ref) return false;
            this.client.bind(ref, 'u_stars', this.asset);
            this.layers.push({ ref, visible: false });
        }
        return true;
    }

    update(speed, shown, now) {
        const trail = updateSilverTrail(this.trail, shown ? speed : null, now);
        const visible = trail.samples.filter((sample) => Math.abs(sample.angle - trail.angle) <= 50).slice(-MAX_STAMPS);
        for (let i = 0; i < this.layers.length; i++) {
            const layer = this.layers[i];
            const sample = visible[i];
            if (!sample) {
                if (layer.visible) this.client.set(layer.ref, { visible: false });
                layer.visible = false;
                continue;
            }
            const { scale, x, y, w, h } = this.geometry;
            const age = (now - sample.at) / TRAIL_LIFETIME_MS;
            const angle = sample.angle - sample.direction * age * 11;
            const radians = angle * Math.PI / 180;
            const dx = (STAMP.x * scale + w / 2) * sample.direction;
            const dy = STAMP.y * scale + h / 2 + age * 5 * scale;
            this.client.uniform(layer.ref, 'u_fade', [Math.round(1000 * (1 - age) ** 1.7) / 1000, sample.direction]);
            this.client.set(layer.ref, {
                x: Math.round(x - w / 2 + dx * Math.cos(radians) - dy * Math.sin(radians)),
                y: Math.round(y - h / 2 + dx * Math.sin(radians) + dy * Math.cos(radians)),
                rotate: angle, visible: true,
            });
            layer.visible = true;
        }
        return visible.length > 0;
    }

    owns(ref) { return ref === this.asset || this.layers.some((layer) => layer.ref === ref); }

    drop() {
        for (const { ref } of this.layers) this.client.drop(ref);
        if (this.asset) this.client.drop(this.asset);
        this.layers = [];
        this.asset = null;
    }
}

module.exports = { SilverStarlight };
