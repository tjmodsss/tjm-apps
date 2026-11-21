'use strict';

const { get: getFont, measure } = require('./kit/fonts');
const { FONTS, TEXT_SIZE_RATIO } = require('./instrument-type');

const MAX_GLYPHS = 5;
const SIZE = { w: 360, h: 112, baseline: 103 };
function shader(font, { colour, offset, outline }) {
    const shadowRGB = colour.map((channel) => (channel / 255).toFixed(5)).join(', ');
    const shifts = outline ? [[offset, 0], [-offset, 0], [0, offset], [0, -offset]] : [[0, offset]];
    const shadowSamples = shifts.map(([x, y]) => `
        q = (p - u_positions[i] - vec2(${x.toFixed(3)}, ${y.toFixed(3)})) / u_scale;
        if (u_ink.a > 0.0 && glyph.z > 0.0 && all(greaterThanEqual(q, vec2(-0.5))) && all(lessThan(q, glyph.zw + vec2(0.5)))) {
            shadow = max(shadow, texture2D(u_font, (glyph.xy + q) / atlas).r);
        }`).join('');
    return `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_font;
uniform vec4 u_ink;
uniform float u_scale;
uniform vec4 u_glyphs[${MAX_GLYPHS}];
uniform vec2 u_positions[${MAX_GLYPHS}];

void main() {
    vec2 p = v_uv * vec2(${SIZE.w}.0, ${SIZE.h}.0);
    vec2 atlas = vec2(${font.atlasW}.0, ${font.atlasH}.0);
    float ink = 0.0;
    float shadow = 0.0;
    for (int i = 0; i < ${MAX_GLYPHS}; i++) {
        vec4 glyph = u_glyphs[i];
        vec2 q = (p - u_positions[i]) / u_scale;
        if (glyph.z > 0.0 && all(greaterThanEqual(q, vec2(-0.5))) && all(lessThan(q, glyph.zw + vec2(0.5)))) {
            ink = max(ink, texture2D(u_font, (glyph.xy + q) / atlas).r);
        }
        ${shadowSamples}
    }
    float edge = (1.0 - ink) * shadow * u_ink.a;
    float opacity = ink + edge;
    gl_FragColor = vec4((ink * u_ink.rgb + edge * vec3(${shadowRGB})) / max(opacity, 0.0001), opacity);
}`;
}

class NativeDigits {
    constructor(client, layout, shadow, sizeRatio = 1) {
        this.client = client;
        this.layout = layout;
        this.shadow = shadow;
        this.textScale = layout.scale * TEXT_SIZE_RATIO * sizeRatio;
        this.labels = [];
    }

    add(weight, label) {
        const font = getFont(FONTS[weight], label.size * this.textScale, '0123456789-');
        const atlas = this.client.asset({
            target: 'panel', format: 'r8', w: font.atlasW, h: font.atlasH, sampling: 'bilinear',
        });
        if (!atlas) return false;
        const reading = { font, atlas, ref: null, visible: false };
        this.labels.push(reading);
        if (!this.client.pixels(atlas, null, font.alpha)) return false;
        reading.ref = this.client.effect({
            target: 'panel', klass: 'overlay', z: 2, w: SIZE.w, h: SIZE.h, visible: false, fs: shader(font, this.shadow),
        });
        if (!reading.ref) return false;
        this.client.bind(reading.ref, 'u_font', atlas);
        return true;
    }

    place(reading, label, value, colour, shown) {
        const client = this.client;
        const { ref, font } = reading;
        if (shown) {
            const layout = this.layout;
            const left = layout.x + label.x * layout.scale - SIZE.w / 2;
            const top = layout.y + label.y * layout.scale - SIZE.baseline;
            const x = Math.round(left);
            const y = Math.round(top);
            const moved = left !== reading.left || top !== reading.top;
            if (moved) {
                client.set(ref, { x, y });
                reading.left = left;
                reading.top = top;
            }
            if (colour !== reading.colour) client.uniform(ref, 'u_ink', colour);
            reading.colour = colour;
            if (moved || value !== reading.value) {
                const advance = measure(font, value);
                const scale = Math.min(label.size * this.textScale / font.size,
                    label.maxWidth ? label.maxWidth * layout.scale / advance : Infinity);
                let pen = (SIZE.w - advance * scale) / 2 + left - x;
                const baseline = SIZE.baseline + top - y;
                const glyphs = new Array(MAX_GLYPHS * 4).fill(0);
                const positions = new Array(MAX_GLYPHS * 2).fill(0);
                Array.from(value).forEach((char, index) => {
                    const [gx, gy, w, h, ox, oy, step] = font.glyphs[char.charCodeAt(0)];
                    glyphs.splice(index * 4, 4, gx, gy, w, h);
                    positions.splice(index * 2, 2, pen + ox * scale, baseline + oy * scale);
                    pen += step * scale;
                });
                client.uniform(ref, 'u_glyphs', glyphs, { type: 'vec4' });
                client.uniform(ref, 'u_positions', positions, { type: 'vec2' });
                client.uniform(ref, 'u_scale', [scale]);
                reading.value = value;
            }
        }
        if (shown !== reading.visible) client.set(ref, { visible: shown });
        reading.visible = shown;
    }

    owns(ref) { return this.labels.some((label) => label.ref === ref || label.atlas === ref); }

    drop() {
        for (const { ref, atlas } of this.labels) {
            if (ref) this.client.drop(ref);
            this.client.drop(atlas);
        }
        this.labels = [];
    }
}

module.exports = { NativeDigits };
