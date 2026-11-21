'use strict';

const fs = require('fs');
const path = require('path');
const { PANEL_WIDTH, PANEL_HEIGHT, panelLayout, PORSCHE_DIALS, SILVER_SIDE_DIALS, SILVER_SIDE_Y } = require('./panel-layout');

const STATUS_AGE_MS = 4000;
const REFRESH_MS = 750;
const PANEL_HANDOFF_MS = 1200;
// Waze accepts window files up to three whole seconds old.
const EXPIRED_WINDOW_MS = 5000;
const MAP_SLOT = { leftInner: 306, rightInner: 654 };

class MapWindow {
    constructor(log, options = {}) {
        this.log = log;
        this.dir = options.dir || '/dev/shm/cluster-info';
        this.status = options.status || '/run/waze-on-cluster/status.json';
        this.now = options.now || Date.now;
        this.file = path.join(this.dir, 'map_window.txt');
        this.fd = null;
        this.leaseKey = null;
        this.nextPoll = 0;
        this.active = null;
        this.warned = false;
        this.message = '';
        this.confirmAfter = 0;
    }

    update(choices, theme) {
        const side = choices.mapMode === 'full'
            ? 'fullMap'
            : Object.keys(MAP_SLOT).find((slot) => choices[slot] === 'waze');
        if (!side) return this.wait('');
        const rect = rectangle(side, theme);
        const leaseKey = [rect.x, rect.y, rect.w, rect.h].join(' ');
        if (this.fd !== null && this.leaseKey !== leaseKey) this.release();
        const now = this.now();
        if (now < this.nextPoll) return this.active;
        this.nextPoll = now + REFRESH_MS;
        this.active = null;
        try {
            const st = fs.statSync(this.status);
            const age = now - st.mtimeMs;
            if (age < 0 || age > STATUS_AGE_MS || !st.isFile() || st.size > 8192) {
                return this.wait('Waze: no recent map status');
            }
            const state = JSON.parse(fs.readFileSync(this.status, 'utf8'));
            if (state.cluster === 0 || state.cluster === false || ['off', 'paused'].includes(state.state) || state.paused) {
                return this.wait('Waze: enable Cluster output and resume the map');
            }
            if (state.hosted) return this.wait('Waze: another layout is hosting the map');
            if (!['map', 'panel'].includes(state.target)) return this.wait('Waze: enable Cluster output');
            if (!['showing', 'starting', 'idle'].includes(state.state)) {
                return this.wait(state.state === 'error' ? 'Waze: map provider reported an error' : 'Waze: waiting for the phone map');
            }
            if (this.fd === null) {
                this.claim(leaseKey, now);
                this.confirmAfter = now + (state.target === 'panel' ? PANEL_HANDOFF_MS : 0);
            }
            if (!this.owns()) return this.wait('Waze: window held by another app');
            const stamp = new Date(now);
            fs.futimesSync(this.fd, stamp, stamp);
            if (state.target === 'panel' && state.state === 'showing' && st.mtimeMs >= this.confirmAfter) this.active = side;
            this.message = this.active ? '' : state.target === 'map' && state.state === 'showing'
                ? 'Waze: map is in BMW view, waiting for panel-window support'
                : 'Waze: waiting for the phone map on the instrument panel';
        } catch (error) {
            if (!this.warned && error.code !== 'ENOENT' && error.code !== 'EEXIST') {
                this.warned = true;
                this.log.warn('Waze window unavailable: ' + error.message);
            }
            if (error.code === 'EEXIST') return this.wait('Waze: window held by another app');
            return this.wait(error.code === 'ENOENT' ? 'Waze: map provider not running' : 'Waze: window unavailable');
        }
        return this.active;
    }

    wait(message) {
        this.release();
        this.message = message;
        return null;
    }

    claim(leaseKey, now) {
        try {
            fs.mkdirSync(this.dir, 0o1777);
            fs.chmodSync(this.dir, 0o1777);
        } catch (error) {
            if (error.code !== 'EEXIST') throw error;
        }
        if (!fs.lstatSync(this.dir).isDirectory()) throw new Error('Waze handoff directory is unavailable');
        try {
            this.fd = fs.openSync(this.file, 'wx', 0o644);
        } catch (error) {
            if (error.code !== 'EEXIST') throw error;
            const expired = fs.lstatSync(this.file);
            if (!expired.isFile() || expired.size > 80 || now - expired.mtimeMs < EXPIRED_WINDOW_MS ||
                !/^panel \d+ \d+ \d+ \d+\s*$/.test(fs.readFileSync(this.file, 'utf8'))) throw error;
            const current = fs.lstatSync(this.file);
            if (current.dev !== expired.dev || current.ino !== expired.ino || current.mtimeMs !== expired.mtimeMs) throw error;
            fs.unlinkSync(this.file);
            this.fd = fs.openSync(this.file, 'wx', 0o644);
        }
        fs.writeFileSync(this.fd, 'panel ' + leaseKey + '\n');
        fs.fchmodSync(this.fd, 0o644);
        this.leaseKey = leaseKey;
    }

    owns() {
        if (this.fd === null) return false;
        try {
            const file = fs.lstatSync(this.file);
            const own = fs.fstatSync(this.fd);
            return file.isFile() && file.dev === own.dev && file.ino === own.ino;
        } catch (error) { return false; }
    }

    release() {
        this.active = null;
        if (this.fd === null) return null;
        try { if (this.owns()) fs.unlinkSync(this.file); } catch (error) { this.log.warn(error.message); }
        try { fs.closeSync(this.fd); } catch (error) { this.log.warn(error.message); }
        this.fd = null;
        this.leaseKey = null;
        this.nextPoll = 0;
        return null;
    }
}

function rectangle(side, theme) {
    if (side === 'fullMap') return { x: 0, y: 0, w: PANEL_WIDTH, h: PANEL_HEIGHT };
    const layout = panelLayout(theme);
    const [cx, cy] = theme === 'five' ? PORSCHE_DIALS[side]
        : theme === 'silver' ? [SILVER_SIDE_DIALS[side], SILVER_SIDE_Y] : [MAP_SLOT[side], 164];
    const top = cy - 26.5;
    const x = Math.round(layout.x + (cx - 60) * layout.scale);
    const y = Math.round(layout.y + top * layout.scale);
    return { x, y, w: Math.round(120 * layout.scale), h: Math.round(53 * layout.scale) };
}

module.exports = { MapWindow, rectangle };
