'use strict';

const cluster = require('./kit/cluster-icon');
const { Canvas } = require('./kit/canvas');
const { t } = require('./kit/i18n');
const WIDTH = 430;
const HEIGHT = 76;
const BASELINE = 47;
const PREFIX = 'DPF Regeneration:';
const FONT_SIZE = 28;
const STATE_GAP = 8;
const HALF_BLINK_MS = 500;
const BLINK_MS = 6 * HALF_BLINK_MS;
const ACTIVE_REPEAT_MS = 60000;
const REQUESTED = { text: 'Requested', colour: '#ffd700' };
const ACTIVE = { text: 'In Progress', colour: '#ff2a2a' };
const COMPLETE = { text: 'Finished', colour: '#23dc5a' };
const BLANK = { text: '' };

function blink(message, elapsed) {
    if (elapsed >= BLINK_MS) return null;
    return Math.floor(elapsed / HALF_BLINK_MS) % 2 === 0 ? message : BLANK;
}

function testMessage(elapsed) {
    const message = [REQUESTED, ACTIVE, COMPLETE][Math.floor(elapsed / BLINK_MS)];
    return message ? blink(message, elapsed % BLINK_MS) : null;
}

function createIndicator() {
    let previous = null;
    let message = null;
    let startedAt = 0;
    return (state, now) => {
        if (state !== previous) {
            message = state === 'requested' ? REQUESTED : state === 'active' ? ACTIVE
                : state === 'idle' && previous === 'active' ? COMPLETE : null;
            startedAt = now;
            previous = state;
        }
        if (!message) return null;
        const elapsed = now - startedAt;
        return blink(message, state === 'active' ? elapsed % ACTIVE_REPEAT_MS : elapsed);
    };
}

function draw(socket, message, frame) {
    const canvas = new Canvas(WIDTH, HEIGHT);
    if (message.text) {
        const style = { font: 'bold', literal: true };
        const prefix = t(PREFIX);
        const status = t(message.text);
        const longestState = Math.max(...[REQUESTED, ACTIVE, COMPLETE]
            .map(state => canvas.textWidth(t(state.text), FONT_SIZE, style)));
        const maxTextWidth = canvas.textWidth(prefix, FONT_SIZE, style) + longestState;
        const fontSize = maxTextWidth > WIDTH - STATE_GAP - 16
            ? Math.floor(FONT_SIZE * (WIDTH - STATE_GAP - 16) / maxTextWidth) : FONT_SIZE;
        const prefixWidth = canvas.textWidth(prefix, fontSize, style);
        const stateWidth = canvas.textWidth(status, fontSize, style);
        const x = Math.round((WIDTH - prefixWidth - STATE_GAP - stateWidth) / 2);
        const stateX = x + prefixWidth + STATE_GAP;
        const shadow = [0, 0, 0, 190];
        canvas.text(prefix, x + 1, BASELINE + 2, fontSize, shadow, style);
        canvas.text(status, stateX + 1, BASELINE + 2, fontSize, shadow, style);
        canvas.text(prefix, x, BASELINE, fontSize, '#ffffff', style);
        canvas.text(status, stateX, BASELINE, fontSize, message.colour, style);
    }
    const body = Buffer.alloc(14 + canvas.d.length);
    body.writeUInt32LE(1, 0);
    body.writeUInt32LE(frame, 4);
    body.set(canvas.d, 14);
    cluster.send(socket, 0x46, body);
}

function start(log, getMessage) {
    cluster.start(log, getMessage, { app: 'dpf', x: 745, y: 539, width: WIDTH, height: HEIGHT,
        key: message => t(PREFIX) + t(message.text), draw });
}

module.exports = { start, createIndicator, testMessage };
