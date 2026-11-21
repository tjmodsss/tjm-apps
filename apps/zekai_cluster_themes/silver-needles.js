'use strict';

const { RotatingNeedles } = require('./rotating-needles');
const { panelLayout, SILVER_CENTRE, SILVER_SIDE_DIALS, SILVER_SIDE_Y } = require('./panel-layout');
const { paintSilverNeedle, speedAngle, rpmAngle, SILVER_PALETTES } = require('./silver-dials');

// Upload each needle and its shadow once, then rotate that image around the
// dial hub with small renderer messages as the vehicle signals change.
class SilverNeedles extends RotatingNeedles {
    constructor(client) {
        super(client, panelLayout('silver'));
        this.lightFace = null;
    }

    add(cx, cy, centre, lightFace) {
        const { scale } = this.layout;
        const px = Math.ceil(32 * scale);
        const py = Math.ceil(98 * scale);
        const w = px + Math.ceil(6 * scale);
        const h = py + Math.ceil(27 * scale);
        return this.addSprite(cx, cy, { px, py, w, h },
            (canvas, x, y, s) => paintSilverNeedle(canvas, x, y, 0, s, centre, lightFace));
    }

    prepare(choices) {
        const lightFace = Boolean((SILVER_PALETTES[choices.faceColour] || SILVER_PALETTES.silver).lightFace);
        if (this.lightFace === lightFace && this.layers.length === 2) return true;
        this.drop();
        this.lightFace = lightFace;
        return this.add(SILVER_CENTRE[0], SILVER_CENTRE[1], true, lightFace) &&
            this.add(SILVER_SIDE_DIALS.leftInner, SILVER_SIDE_Y, false, false);
    }

    update(data, choices, shown) {
        this.move([
            speedAngle(data.speed),
            !choices.leftInner || choices.leftInner === 'rpm' ? rpmAngle(data.rpm) : null,
        ], shown);
    }
}

module.exports = { SilverNeedles };
