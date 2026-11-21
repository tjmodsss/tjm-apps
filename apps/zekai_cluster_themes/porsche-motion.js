'use strict';

const { rgba } = require('./kit/canvas');
const { panelLayout, PORSCHE_CENTRE } = require('./panel-layout');
const { RotatingNeedles } = require('./rotating-needles');
const { NativeDigits } = require('./native-digits');
const {
    SLOTS, PALETTES, INK, porscheGaugeLayout, porscheSpeedLabel, porscheMotionAngle, paintPorscheNeedle,
} = require('./dials');

class PorscheMotion {
    constructor(client) {
        this.client = client;
        this.layout = panelLayout('five');
        this.needles = new RotatingNeedles(client, this.layout);
        this.digits = null;
        this.key = null;
    }

    addNeedle(cx, cy, length, width, hub) {
        const { scale } = this.layout;
        const px = Math.ceil((Math.max(hub + 2, width) + 2) * scale);
        const py = Math.ceil((length + width) * scale);
        const h = py + Math.ceil((Math.max(hub + 2, length * 0.18) + width) * scale);
        return this.needles.addSprite(cx, cy, { px, py, w: 2 * px + 1, h }, (canvas, x, y, s) => {
            const line = (ax, ay, bx, by, weight, ink) => canvas.line(x + ax * s, y + ay * s, x + bx * s, y + by * s, weight * s, ink);
            const disc = (dx, dy, radius, ink) => canvas.circle(x + dx * s, y + dy * s, radius * s, ink);
            paintPorscheNeedle(line, disc, 0, 0, 0, length, width, hub);
        });
    }

    prepare(choices) {
        const slots = SLOTS.filter((slot) => choices[slot] === 'analogueSpeed');
        const key = JSON.stringify([choices.faceColour, choices.speedPosition, slots]);
        if (this.key === key) return true;
        this.drop();
        const lower = choices.speedPosition !== 'centre';
        const [cx, cy] = PORSCHE_CENTRE;
        if (!this.addNeedle(cx, cy, 88, lower ? 3.1 : 3, lower ? 7 : 0)) return false;
        for (const slot of slots) {
            const [x, y, radius] = porscheGaugeLayout(slot);
            if (!this.addNeedle(x, y, radius - 7, 2.7, 5)) return false;
        }
        const palette = PALETTES[choices.faceColour] || PALETTES.navy;
        const shadow = {
            colour: rgba(palette.textShadow || '#000000').slice(0, 3),
            offset: (palette.outline ? 0.95 : 0.9) * this.layout.scale,
            outline: palette.outline,
        };
        this.ink = rgba(palette.ink || INK).slice(0, 3).map((value) => value / 255).concat(palette.textShadow ? 1 : 0);
        this.label = porscheSpeedLabel(choices);
        this.label.maxWidth *= 0.9;
        this.digits = new NativeDigits(this.client, this.layout, shadow, 0.9);
        if (!this.digits.add('bold', this.label)) return false;
        this.key = key;
        return true;
    }

    update(data, shown) {
        const speed = porscheMotionAngle('speed', data.speed);
        const angles = this.needles.layers.map((layer, index) => index === 0 ? porscheMotionAngle('rpm', data.rpm) : speed);
        this.needles.move(angles, shown);
        const value = Number.isFinite(data.speed) ? data.speed.toFixed(0) : '--';
        this.digits.place(this.digits.labels[0], this.label, value, this.ink, shown);
    }

    owns(ref) {
        return this.needles.owns(ref) || (this.digits && this.digits.owns(ref));
    }

    drop() {
        this.needles.drop();
        if (this.digits) this.digits.drop();
        this.digits = null;
        this.key = null;
    }
}

module.exports = { PorscheMotion };
