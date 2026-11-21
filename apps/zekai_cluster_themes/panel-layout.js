'use strict';

const PANEL_WIDTH = 1920;
const PANEL_HEIGHT = 720;
const PORSCHE_CENTRE = [480, 168, 138];
const PORSCHE_DIALS = {
    leftOuter: [170, 181, 70],
    leftInner: [286, 173, 96],
    rightInner: [674, 173, 96],
    rightOuter: [790, 181, 70],
};
const SILVER_SIDE_DIALS = { leftInner: 252, rightInner: 708 };
const SILVER_SIDE_Y = 171;
const SILVER_CENTRE = [480, 165];
const SILVER_SCALE = 2.68;
const SILVER_HUB_Y = 338;
// Leave the round bezel just clear of the two side dials.
const SILVER_BEZEL_MARGIN = 10;
const SILVER_BEZEL = {
    y: SILVER_CENTRE[1] + (PANEL_HEIGHT / 2 - SILVER_HUB_Y) / SILVER_SCALE,
    radius: (PANEL_HEIGHT / 2 - SILVER_BEZEL_MARGIN) / SILVER_SCALE,
};
// Leave BMW's gear letter visible through the Rolls Royce panel on the G05.
const BMW_GEAR_WINDOW = { x: 1380, y: 650, w: 80, h: 70 };

function panelLayout(theme) {
    if (theme === 'five') {
        const scale = 2.48;
        const [cx, cy] = PORSCHE_CENTRE;
        return { scale, x: PANEL_WIDTH / 2 - cx * scale, y: PANEL_HEIGHT / 2 - cy * scale };
    }
    if (theme === 'silver') {
        const [cx, cy] = SILVER_CENTRE;
        return { scale: SILVER_SCALE, x: PANEL_WIDTH / 2 - cx * SILVER_SCALE, y: SILVER_HUB_Y - cy * SILVER_SCALE };
    }
    if (theme === 'vdoRetro') {
        const scale = 2.26;
        return { scale, x: PANEL_WIDTH / 2 - 480 * scale, y: PANEL_HEIGHT / 2 - 163 * scale };
    }
    return { scale: 2, x: 0, y: 40 };
}

module.exports = {
    PANEL_WIDTH, PANEL_HEIGHT, panelLayout, PORSCHE_CENTRE, PORSCHE_DIALS,
    SILVER_SIDE_DIALS, SILVER_SIDE_Y, SILVER_CENTRE, SILVER_BEZEL, BMW_GEAR_WINDOW,
};
