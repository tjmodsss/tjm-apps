'use strict';

const { panelLayout } = require('./panel-layout');
const { NativeDigits } = require('./native-digits');
const { SILVER_SPEED_LABEL, sideLabel, speedAngle, valueText, SILVER_PALETTES, SILVER_TEXT_SHADOW } = require('./silver-dials');

const WHITE = [1, 1, 1, 0];
const SHADED_WHITE = [1, 1, 1, SILVER_TEXT_SHADOW.colour[3] / 255];

class SilverDigits extends NativeDigits {
    constructor(client) {
        const layout = panelLayout('silver');
        super(client, layout, {
            colour: SILVER_TEXT_SHADOW.colour.slice(0, 3),
            offset: SILVER_TEXT_SHADOW.offset * layout.scale,
        });
    }

    prepare() {
        return this.add('bold', SILVER_SPEED_LABEL) && this.add('regular', sideLabel('leftInner', false));
    }

    update(data, choices, shown) {
        const palette = SILVER_PALETTES[choices.faceColour] || SILVER_PALETTES.silver;
        const rpmLabel = sideLabel('leftInner', !!choices.leftInner && choices.leftInner !== 'rpm');
        const speed = speedAngle(data.speed) === null ? null : data.speed;
        this.place(this.labels[0], SILVER_SPEED_LABEL, valueText(speed), palette.lightFace ? SHADED_WHITE : WHITE, shown);
        this.place(this.labels[1], rpmLabel, valueText(data.rpm), WHITE, shown);
    }
}

module.exports = { SilverDigits };
