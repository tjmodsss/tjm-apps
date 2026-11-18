'use strict';

const { EventEmitter } = require('events');
const { ClusterRender } = require('./cluster_render_client');
const { Car } = require('./car');
const { MapWindow } = require('./map-window');
const { SLOTS, SILVER_SLOTS } = require('./dials');
const { PANEL_WIDTH, PANEL_HEIGHT } = require('./panel-layout');
const { renderPanelFrame, sendPanelFrame } = require('./panel-frame');

const DRAW_INTERVAL_MS = 100;
const PANEL_FPS = 10;
const RECOVERY_DELAYS_MS = [2000, 5000, 10000, 20000, 30000];

function localTime() {
    return new Date().toTimeString().slice(0, 5);
}

class ClusterService extends EventEmitter {
    constructor(context) {
        super();
        this.context = context;
        this.settings = context.settings;
        this.log = context.log;
        this.client = null;
        this.ref = null;
        this.connected = false;
        this.timer = null;
        this.motionTimer = null;
        this.lastDrawAt = -Infinity;
        this.lastFrame = null;
        this.lastPixels = null;
        this.scratchPixels = null;
        this.faceCache = {};
        this.message = 'Starting cluster theme service';
        this.mapMessage = '';
        this.layerState = '';
        this.retryAt = 0;
        this.failures = 0;
        this.destroyed = false;
        this.theme = 'stock';
        this.choices = {};
        this.car = new Car(Date.now, () => this.requestMotionDraw());
        this.map = new MapWindow(this.log);
        this.car.watch(context);
        this.settings.onChange(() => this.configure());
        if (context.app && context.app.on) context.app.on('shutdown', () => this.destroy());
        process.on('exit', () => this.destroy());
        this.configure();
    }

    status() { return this.mapMessage ? this.message + ' · ' + this.mapMessage : this.message; }

    report(message) {
        if (message === this.message) return;
        this.message = message;
        this.emit('status', this.status());
    }

    choice(key) {
        const item = this.settings.item(key);
        const value = this.settings.get(key);
        return item && item.options && item.options.some(([id]) => id === value) ? value : item.default;
    }

    selections(theme) {
        if (theme === 'stock' || theme === 'vdoRetro') return {};
        if (theme === 'wazeFull') return { mapMode: 'full' };
        const slots = {};
        const keys = theme === 'silver' ? SILVER_SLOTS : SLOTS;
        for (const key of keys.concat('fallback')) slots[key] = this.choice(theme + '_' + key);
        if (theme === 'five') {
            slots.faceColour = this.choice('five_faceColour');
            slots.speedPosition = this.choice('five_speedPosition');
            slots.fullRangeKm = this.choice('five_fullRangeKm');
        }
        return slots;
    }

    configure() {
        if (this.destroyed) return;
        const theme = this.choice('instrumentTheme');
        const enabled = this.settings.get('clusterOverlayEnabled') !== false && theme !== 'stock';
        if (!enabled) {
            this.theme = 'stock';
            this.stop();
            return;
        }
        this.theme = theme;
        this.choices = this.selections(theme);
        this.lastFrame = null;
        if (!this.timer) this.timer = setInterval(() => this.tick(), DRAW_INTERVAL_MS);
        this.tick();
    }

    tick() {
        if (this.client) this.draw();
        else if (Date.now() >= this.retryAt) this.connect();
    }

    requestMotionDraw() {
        if (!this.connected || !this.ref || this.motionTimer) return;
        const delay = DRAW_INTERVAL_MS - (Date.now() - this.lastDrawAt);
        if (delay <= 0) return this.draw();
        this.motionTimer = setTimeout(() => {
            this.motionTimer = null;
            this.draw();
        }, delay);
    }

    connect() {
        this.report('Connecting to the instrument panel');
        const client = new ClusterRender(this.context.spec.id);
        this.client = client;
        const current = () => this.client === client;
        client.on('ready', () => {
            if (!current()) return;
            if (client.backend !== 'id7' || !String(client.targets).split(',').includes('panel:' + PANEL_WIDTH + 'x' + PANEL_HEIGHT)) {
                this.stop();
                this.report('This renderer does not expose the full ID7 panel');
                return;
            }
            this.connected = true;
            if (!this.ref) {
                this.ref = client.image({
                    target: 'panel', klass: 'overlay', x: 0, y: 0, w: PANEL_WIDTH, h: PANEL_HEIGHT,
                    iw: PANEL_WIDTH, ih: PANEL_HEIGHT, sampling: 'nearest', contend: false, fps: PANEL_FPS,
                });
                if (!this.ref) return this.recover();
            }
            this.lastFrame = null;
            this.lastPixels = null;
            this.layerState = '';
            this.lastDrawAt = -Infinity;
            this.draw();
        });
        client.on('disconnected', () => {
            if (!current()) return;
            this.connected = false;
            this.lastFrame = null;
            this.map.release();
            this.report('Renderer reconnecting; selected theme will resume');
        });
        client.on('layer', (ref, state, reason) => {
            if (!current() || ref !== this.ref) return;
            this.layerState = state;
            if (this.log.info) this.log.info('Cluster panel layer: ' + state + (reason ? ' (' + reason + ')' : ''));
            if (state === 'shown') {
                this.failures = 0;
                this.report('Selected theme active');
            }
            else if (state === 'suspended' || state === 'hidden') {
                this.map.wait('');
                this.setMapMessage('');
                this.report('Instrument panel temporarily unavailable');
            } else if (state === 'error') this.report('Renderer reported a cluster layer error');
        });
        client.on('target', (target, state, holder, reason) => {
            if (current() && target === 'panel' && this.log.info) {
                this.log.info('Cluster panel target: ' + state + (reason ? ' (' + reason + ')' : ''));
            }
        });
        client.on('refused', (op, ref, reason) => {
            if (!current()) return;
            this.log.warn('Cluster renderer refused ' + op + ': ' + reason);
            if (op === 'image' || op === 'frame') this.recover();
            else this.report('Renderer refused the cluster theme');
        });
        client.connect();
    }

    setMapMessage(message) {
        if (message === this.mapMessage) return;
        this.mapMessage = message;
        if (message && this.log.info) this.log.info(message);
        this.emit('status', this.status());
    }

    draw() {
        if (!this.client || !this.connected || !this.ref || this.theme === 'stock' || this.client.blocked) return;
        const now = Date.now();
        if (now - this.lastDrawAt < DRAW_INTERVAL_MS) return;
        try {
            const data = this.car.snapshot();
            // The speed text uses whole km/h. Avoid repainting the panel for
            // fluctuations that do not change the displayed reading.
            if (this.theme !== 'vdoRetro' && Number.isFinite(data.speed)) data.speed = Math.round(data.speed);
            data.clock = localTime();
            const panelAvailable = this.layerState !== 'suspended' && this.layerState !== 'hidden';
            data.mapSlot = panelAvailable ? this.map.update(this.choices, this.theme) : null;
            this.setMapMessage(panelAvailable ? this.map.message : '');
            const signature = JSON.stringify([this.theme, this.choices, data]);
            if (signature === this.lastFrame) return;

            this.lastDrawAt = now;
            const frame = renderPanelFrame(this.theme, this.choices, data, false, this.scratchPixels || undefined,
                this.faceCache);
            if (!sendPanelFrame(this.client, this.ref, frame, this.lastPixels)) return;
            this.scratchPixels = this.lastPixels;
            this.lastPixels = frame;
            this.lastFrame = signature;
        } catch (error) {
            this.log.warn('cluster theme draw: ' + (error && error.message || error));
            this.recover();
        }
    }

    recover() {
        const delay = RECOVERY_DELAYS_MS[Math.min(this.failures++, RECOVERY_DELAYS_MS.length - 1)];
        this.retryAt = Date.now() + delay;
        this.releaseClient();
        this.report('Theme interrupted; reconnecting automatically');
    }

    releaseClient() {
        if (this.motionTimer) clearTimeout(this.motionTimer);
        this.motionTimer = null;
        this.lastDrawAt = -Infinity;
        const client = this.client;
        this.client = null;
        this.ref = null;
        this.connected = false;
        this.lastFrame = null;
        this.lastPixels = null;
        this.scratchPixels = null;
        this.faceCache = {};
        this.layerState = '';
        this.map.wait('');
        this.setMapMessage('');
        if (client) client.close();
    }

    stop() {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
        this.retryAt = 0;
        this.failures = 0;
        this.releaseClient();
        this.report('BMW original active');
    }

    destroy() {
        this.destroyed = true;
        this.stop();
    }
}

module.exports = { ClusterService };
