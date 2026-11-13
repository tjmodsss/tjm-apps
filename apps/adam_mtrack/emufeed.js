'use strict';
/**
 * emufeed.js - EMULATOR ONLY. main.js requires it only when MTRACK_EMU_FEED is set, which the emulator harness
 * (test/adam_mtrack/emu-run.sh, view.sh) does and nothing on a car does: the head unit starts apps with its own
 * environment, so this file is never loaded there. The idrive7-apps emulator feeds only rpm, speed, temperatures,
 * gear, acceleration and torque; this lets a script drive the rest of what M Track reads, and stall the speed:
 *
 *   one JSON object a line on the Unix socket at MTRACK_EMU_FEED:
 *     { "iface": "<SOME/IP interface>", "field": "<field>", "value": <the field's struct> }
 *         calls the handlers main.js watched that interface with, as a car notification would
 *     { "block": "speed", "on": true | false }
 *         swallows (or lets through again) every speed notification and poll result: the speed goes stale
 *     { "action": "test:1" }   ("test:1" to "test:5", "test:stop")
 *         presses a Safety-page test pattern control, as main.js's act does
 *
 * Every callback goes through guard; a bad line is logged and skipped. Reconnects every second when the socket goes.
 */
const net = require('net');

function start(sockPath, hooks, log, guard) {
    let buf = '';
    const handle = guard('emu feed', (line) => {
        if (!line.trim()) return;
        const m = JSON.parse(line);
        if (m.block === 'speed') { hooks.blockSpeed = m.on === true; log.info('emu feed: speed ' + (hooks.blockSpeed ? 'blocked' : 'flowing')); return; }
        if (typeof m.action === 'string') { log.info('emu feed: action ' + m.action); if (hooks.action) hooks.action(m.action); return; }
        const hs = hooks.handlers[m.iface] || [];
        let n = 0;
        hs.forEach((h) => { if (typeof h[m.field] === 'function') { h[m.field](m.value); n++; } });
        if (!n) log.warn('emu feed: nothing watches ' + m.iface + '.' + m.field);
    });
    const connect = () => {
        const s = net.connect(sockPath);
        s.on('connect', () => log.info('emu feed: connected to ' + sockPath));
        s.on('data', (d) => { buf += d.toString('utf8'); let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); handle(l); } });
        s.on('error', () => {});
        s.on('close', () => { buf = ''; setTimeout(connect, 1000); });
    };
    connect();
}

module.exports = { start };
