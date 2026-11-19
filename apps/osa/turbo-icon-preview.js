'use strict';

const net = require('net');
const { Canvas } = require('./kit/canvas');
const { warmupLabel } = require('./cluster-locales');
const WIDTH = 430;
const HEIGHT = 76;
const UPPER = { x: 745, y: 539, width: WIDTH, height: HEIGHT, baseline: 47 };
const LOWER = { x: 780, y: 650, width: 360, height: 58, baseline: 40 };
const MESSAGE_MS = 4000;
const socketPath = '/dev/shm/cluster-render/render.sock';

function send(socket, type, body) {
    const header = Buffer.alloc(5);
    header.writeUInt32LE(body.length + 1, 0);
    header[4] = type;
    socket.write(Buffer.concat([header, body]));
}
const command = (socket, value) => send(socket, 0x4a, Buffer.from(JSON.stringify(value)));
function drawMessage(socket, target, label, frame, placement) {
    const { width, height, baseline } = placement;
    const canvas = new Canvas(width, height);
    const labelStyle = { font: 'bold', literal: true };
    const temperatureStyle = { align: 'right', literal: true };
    const temperature = target + ' °C';
    const available = width - 68 - canvas.textWidth(temperature, 30, temperatureStyle);
    let labelSize = 32;
    while (canvas.textWidth(label, labelSize, labelStyle) > available) labelSize--;
    canvas.text(label, 25, baseline + 2, labelSize, [0, 0, 0, 190], labelStyle);
    canvas.text(temperature, width - 23, baseline + 2, 30, [0, 0, 0, 190], temperatureStyle);
    canvas.text(label, 24, baseline, labelSize, '#ffffff', labelStyle);
    canvas.text(temperature, width - 24, baseline, 30, '#ffb547', temperatureStyle);
    const body = Buffer.alloc(14 + canvas.d.length);
    body.writeUInt32LE(1, 0);
    body.writeUInt32LE(frame, 4);
    body.set(canvas.d, 14);
    send(socket, 0x46, body);
}

function createWarmupMessage() {
    let previousTarget = null;
    let armed = false;
    let reachedAt = null;

    return (temperature, target, now) => {
        if (target !== previousTarget) {
            previousTarget = target;
            armed = temperature < target;
            reachedAt = null;
        }
        if (reachedAt !== null && now - reachedAt < MESSAGE_MS) return target;
        if (temperature <= target - 2) armed = true;
        if (!armed || temperature < target) return null;
        armed = false;
        reachedAt = now;
        return target;
    };
}

function readEvents(socket, report) {
    let pending = Buffer.alloc(0);
    socket.on('data', chunk => {
        pending = Buffer.concat([pending, chunk]);
        while (pending.length >= 5) {
            const length = pending.readUInt32LE(0);
            if (length < 1 || length > 1024 * 1024) { socket.destroy(); return; }
            if (pending.length < length + 4) return;
            const type = pending[4];
            const body = pending.slice(5, length + 4);
            pending = pending.slice(length + 4);
            if (type !== 0x4a) continue;
            let event;
            try { event = JSON.parse(body.toString('utf8')); } catch (error) { continue; }
            if (!event) continue;
            if (event.ev === 'target' && event.target === 'panel') {
                report(['Panel:', event.state, event.holder === 'none' ? '' : event.holder, event.reason].filter(Boolean).join(' '));
            } else if (event.ev === 'layer' && event.ref === 1) {
                report(['Layer:', event.state, event.reason].filter(Boolean).join(' '));
            } else if (event.ev === 'status' && typeof event.text === 'string') {
                const slots = event.text.split(/\r?\n/).map(line => line.trim())
                    .filter(line => /^slot 0x[0-9a-f]+\b/i.test(line));
                if (slots.length) report(slots);
            } else if (event.ev === 'error') {
                report('Renderer: ' + (event.reason || event.op || 'error'));
            }
        }
    });
}

// Keep the cluster message independent of the currently visible iDrive page.
function start(log, getMessage, report, testing, isLower, getLanguage) {
    if (process.env.MGU_RENDERD_SOCKET && /mgu-emu-/.test(process.env.MGU_RENDERD_SOCKET)) return;

    let client = null;
    let retryAt = 0;

    function connect() {
        const socket = net.createConnection(socketPath);
        const connection = { socket, ready: false, frame: 0, message: null, nextStatus: 0, target: null, placement: null };
        client = connection;
        const deadline = setTimeout(() => socket.destroy(), 4000);
        deadline.unref();
        socket.unref();
        socket.once('connect', () => {
            clearTimeout(deadline);
            command(socket, { op: 'hello', app: 'osa', proto: 1 });
            connection.ready = true;
            refresh();
            log.info('OSA: connected to cluster-render for oil warm-up message');
        });
        readEvents(socket, report);
        socket.on('error', error => report('Renderer: socket ' + (error.code || error.message)));
        socket.once('close', () => {
            clearTimeout(deadline);
            if (client === connection) {
                client = null;
                retryAt = Date.now() + 5000;
            }
        });
    }

    function refresh() {
        const message = getMessage();
        const testActive = testing();
        if (message === null && !testActive) {
            const connection = client;
            client = null;
            retryAt = 0;
            if (connection && connection.ready && !connection.socket.destroyed) {
                if (connection.target) command(connection.socket, { op: 'drop', ref: 1 });
                connection.socket.end();
                const deadline = setTimeout(() => connection.socket.destroy(), 1000);
                deadline.unref();
                connection.socket.once('close', () => clearTimeout(deadline));
            } else if (connection) {
                connection.socket.destroy();
            }
            return;
        }
        if (!client) {
            if (Date.now() >= retryAt) connect();
            return;
        }
        if (!client.ready || client.socket.destroyed) return;
        const socket = client.socket;
        const target = message === null ? null : 'panel';
        const placement = isLower() ? LOWER : UPPER;
        if (target !== client.target || (target && placement !== client.placement)) {
            if (client.target) command(socket, { op: 'drop', ref: 1 });
            client.target = target;
            client.placement = placement;
            client.message = null;
            if (target) {
                command(socket, { op: 'layer', ref: 1, kind: 'image', target, class: 'overlay',
                    x: placement.x, y: placement.y, w: placement.width, h: placement.height,
                    iw: placement.width, ih: placement.height,
                    exclusive: 0, contend: 0 });
            }
        }
        if (testActive && Date.now() >= client.nextStatus) {
            command(socket, { op: 'status' });
            client.nextStatus = Date.now() + 750;
        }
        if (message === null) return;
        const label = warmupLabel(getLanguage());
        if (message === client.message && label === client.label) return;
        client.message = message;
        client.label = label;
        client.frame = (client.frame + 1) >>> 0;
        drawMessage(client.socket, message, label, client.frame, placement);
    }

    refresh();
    setInterval(refresh, 250).unref();
}

module.exports = { start, createWarmupMessage, readEvents, MESSAGE_MS };
