'use strict';

const { EventEmitter } = require('events');
const { Canvas } = require('./kit/canvas');
const { ClusterRender } = require('./cluster_render_client');
const { Car } = require('./car');
const { MapWindow } = require('./map-window');
const { SLOTS, SILVER_SLOTS } = require('./dials');
const { PANEL_WIDTH, PANEL_HEIGHT } = require('./panel-layout');
const { renderPanelFrame, sendPanelFrame } = require('./panel-frame');
const { SilverNeedles } = require('./silver-needles');
const { SilverDigits } = require('./silver-digits');
const { PorscheMotion } = require('./porsche-motion');
const { SilverStarlight } = require('./silver-starlight');
const { clusterClock } = require('./cluster-clock');
const { EngineReadings } = require('./engine-readings');
const { OnlineArtwork } = require('./online-artwork');
const { withArtwork } = require('./media-artwork');

const DRAW_INTERVAL_MS = 50;
const NATIVE_MOTION_INTERVAL_MS = 16;
const PANEL_FPS = 20;
const MOTION_LOG_INTERVAL_MS = 15000;
const MAX_SOCKET_BLOCK_MS = 400;
const LIVE_SPEED_GRACE_MS = 1500;
const LIVE_SPEED_SETTLE_MS = 750;
const NATIVE_THEMES = { silver: 'Rolls Royce', five: 'Porsche' };
const SILVER_BACKGROUND_SCALES = [1, 0.75, 0.5];
const PIXEL_MEMORY_FULL = "the service's pixel memory is full";
const RECOVERY_DELAYS_MS = [2000, 5000, 10000, 20000, 30000];

class ClusterService extends EventEmitter {
    constructor(context) {
        super();
        this.context = context;
        this.settings = context.settings;
        this.onlineArtwork = new OnlineArtwork(context.dataDir);
        this.log = context.log;
        this.client = null;
        this.ref = null;
        this.connected = false;
        this.timer = null;
        this.motionTimer = null;
        this.nativeMotionTimer = null;
        this.lastNativeMotionAt = -Infinity;
        this.nextMotionLogAt = 0;
        this.lastDrawAt = -Infinity;
        this.lastFrame = null;
        this.lastPixels = null;
        this.scratchPixels = null;
        this.faceCache = {};
        this.porscheMotion = null;
        this.silverNeedles = null;
        this.silverDigits = null;
        this.silverStarlight = null;
        this.starlightFailed = false;
        this.nativeMotionFailed = false;
        this.liveSince = null;
        this.missingSince = null;
        this.blockedSince = null;
        this.message = 'Starting cluster theme service';
        this.mapMessage = '';
        this.layerState = '';
        this.retryAt = 0;
        this.failures = 0;
        this.destroyed = false;
        this.theme = 'stock';
        this.silverBackgroundScaleIndex = 0;
        this.choices = {};
        this.car = new Car(Date.now, () => this.requestMotionDraw());
        this.engineReadings = new EngineReadings(context, (key, value) => this.car.put(key, value));
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
        if (theme === 'silver') {
            slots.faceColour = this.choice('silver_faceColour');
            slots.needleEffect = this.choice('silver_needleEffect');
        }
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
        const choices = this.selections(theme);
        if (theme !== this.theme || SLOTS.some((key) => this.choices[key] !== choices[key])) this.engineReadings.cancel();
        if (theme !== this.theme) {
            this.dropNativeMotion();
            if (this.silverBackgroundScaleIndex) {
                this.dropPanelImage();
                this.silverBackgroundScaleIndex = 0;
            }
            this.nativeMotionFailed = false;
            this.liveSince = null;
            this.missingSince = null;
            this.lastNativeMotionAt = -Infinity;
        }
        if (choices.needleEffect !== this.choices.needleEffect) this.starlightFailed = false;
        this.theme = theme;
        this.choices = choices;
        this.lastFrame = null;
        this.lastDrawAt = -Infinity;
        if (this.layerState === 'shown') this.reportActive();
        if (!this.timer) this.timer = setInterval(() => this.tick(), DRAW_INTERVAL_MS);
        this.tick();
    }

    tick() {
        const now = Date.now();
        if (NATIVE_THEMES[this.theme] && !this.liveSpeedAvailable(now)) return;
        if (this.client) {
            this.draw();
            if (this.layerState === 'shown' && this.log.info && now >= this.nextMotionLogAt) {
                this.nextMotionLogAt = now + MOTION_LOG_INTERVAL_MS;
                const needles = this.silverNeedles || this.porscheMotion ? 'native' : 'bitmap';
                const digits = this.silverDigits || this.porscheMotion ? 'native' : 'bitmap';
                this.log.info('Cluster motion (' + this.theme + ', needles ' + needles + ', digits ' + digits + '): ' +
                    this.car.takeMotionStats());
            }
            if (this.connected && this.layerState !== 'hidden' && this.layerState !== 'suspended' &&
                this.theme === 'five' && Number.isFinite(this.car.motion().speed)) {
                this.engineReadings.update(SLOTS.map((key) => this.choices[key]));
            }
        }
        else if (now >= this.retryAt) this.connect();
    }

    liveSpeedAvailable(now) {
        if (this.nativeMotionFailed) return false;
        if (Number.isFinite(this.car.motion().speed)) {
            this.missingSince = null;
            if (this.liveSince === null) this.liveSince = now;
            return Boolean(this.client) || now - this.liveSince >= LIVE_SPEED_SETTLE_MS;
        }
        this.liveSince = null;
        if (this.client && this.lastFrame) {
            if (this.missingSince === null) this.missingSince = now;
            if (now - this.missingSince < LIVE_SPEED_GRACE_MS) return true;
        }
        if (this.client) this.releaseClient();
        this.report('BMW original · Waiting for live speed');
        return false;
    }

    requestMotionDraw() {
        if (!this.connected || !this.ref) return;
        if (this.porscheMotion || this.silverNeedles || this.silverDigits) {
            this.scheduleNativeMotion();
            return;
        }
        const delay = DRAW_INTERVAL_MS - (Date.now() - this.lastDrawAt);
        if (delay <= 0) {
            if (this.motionTimer) clearTimeout(this.motionTimer);
            this.motionTimer = null;
            return this.draw();
        }
        if (this.motionTimer) return;
        this.motionTimer = setTimeout(() => {
            this.motionTimer = null;
            this.draw();
        }, delay);
    }

    scheduleNativeMotion() {
        if (this.nativeMotionTimer || !this.connected || this.client.blocked || this.layerState !== 'shown') return;
        const delay = Math.max(0, NATIVE_MOTION_INTERVAL_MS - (Date.now() - this.lastNativeMotionAt));
        this.nativeMotionTimer = setTimeout(() => {
            this.nativeMotionTimer = null;
            try { this.sendNativeMotion(Date.now()); }
            catch (error) {
                this.log.warn('Cluster native motion: ' + (error && error.message || error));
                this.recover();
            }
        }, delay);
    }

    sendNativeMotion(now) {
        if ((!this.porscheMotion && !this.silverNeedles && !this.silverDigits) || !this.connected || this.client.blocked ||
            this.layerState !== 'shown' || now - this.lastNativeMotionAt < NATIVE_MOTION_INTERVAL_MS) return;
        this.lastNativeMotionAt = now;
        this.updateNativeMotion(this.car.motion(), true, now);
    }

    reportActive() {
        const starlightUnavailable = this.theme === 'silver' && this.choices.needleEffect === 'starlight' && this.starlightFailed;
        this.report(starlightUnavailable ? 'Selected theme active · Starlight unavailable' : 'Selected theme active');
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
            this.lastFrame = null;
            this.lastPixels = null;
            this.layerState = '';
            this.lastDrawAt = -Infinity;
            this.lastNativeMotionAt = -Infinity;
            this.draw();
        });
        client.on('disconnected', () => {
            if (!current()) return;
            this.engineReadings.cancel();
            this.connected = false;
            this.lastFrame = null;
            this.blockedSince = null;
            this.updateNativeMotion({}, false);
            this.map.release();
            if (this.theme === 'wazeFull') this.dropPanelImage();
            this.report('Renderer reconnecting; selected theme will resume');
        });
        client.on('layer', (ref, state, reason) => {
            if (!current()) return;
            if (state === 'error' && this.handleRenderError(ref, reason)) return;
            if (ref !== this.ref) return;
            this.layerState = state;
            if (this.log.info) this.log.info('Cluster panel layer: ' + state + (reason ? ' (' + reason + ')' : ''));
            if (state === 'shown') {
                this.failures = 0;
                this.reportActive();
                if (this.porscheMotion || this.silverNeedles || this.silverDigits) this.scheduleNativeMotion();
            }
            else if (state === 'suspended' || state === 'hidden') {
                this.engineReadings.cancel();
                this.updateNativeMotion({}, false);
                this.map.wait('');
                this.setMapMessage('');
                this.report('Instrument panel temporarily unavailable');
            } else if (state === 'error') this.report('Renderer reported a cluster layer error');
        });
        client.on('drain', () => {
            if (current() && !client.blocked) this.requestMotionDraw();
        });
        client.on('target', (target, state, holder, reason) => {
            if (current() && target === 'panel' && this.log.info) {
                this.log.info('Cluster panel target: ' + state + (reason ? ' (' + reason + ')' : ''));
            }
        });
        client.on('budget', (cap, ceiling, reason) => {
            if (current() && this.log.info) {
                this.log.info('Cluster renderer upload budget: ' + cap + '/' + ceiling + ' KB/s (' + reason + ')');
            }
        });
        client.on('refused', (op, ref, reason) => {
            if (!current()) return;
            if (this.handleRenderError(ref, reason)) return;
            this.log.warn('Cluster renderer refused ' + op + ': ' + reason);
            if ((op === 'image' || op === 'layer' || op === 'frame') && ref === this.ref) this.recover();
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

    dropPanelImage() {
        if (!this.ref) return;
        this.client.drop(this.ref);
        this.ref = null;
        this.layerState = '';
        this.lastFrame = null;
        this.lastPixels = null;
        this.scratchPixels = null;
    }

    dropNativeMotion() {
        if (this.porscheMotion) this.porscheMotion.drop();
        if (this.silverNeedles) this.silverNeedles.drop();
        if (this.silverDigits) this.silverDigits.drop();
        if (this.silverStarlight) this.silverStarlight.drop();
        this.porscheMotion = null;
        this.silverNeedles = null;
        this.silverDigits = null;
        this.silverStarlight = null;
    }

    updateNativeMotion(data, shown, now = Date.now()) {
        if (this.porscheMotion) this.porscheMotion.update(data, shown);
        if (this.silverNeedles) this.silverNeedles.update(data, this.choices, shown);
        if (this.silverDigits) this.silverDigits.update(data, this.choices, shown);
        if (this.silverStarlight && this.silverStarlight.update(data.speed, shown, now)) this.scheduleNativeMotion();
    }

    rejectNativeMotion(reason) {
        const title = NATIVE_THEMES[this.theme];
        this.log.warn(title + ' motion layer unavailable: ' + reason);
        this.nativeMotionFailed = true;
        this.releaseClient();
        const detail = String(reason || '').replace(/\s+/g, ' ').trim().slice(0, 60);
        this.report('BMW original · ' + title + ' live rendering unavailable' + (detail ? ' · ' + detail : ''));
    }

    retryNativeMotion() {
        if (!this.nativeMotionFailed) return;
        this.nativeMotionFailed = false;
        this.retryAt = 0;
        this.configure();
    }

    handleRenderError(ref, reason) {
        const nativeMotion = (this.porscheMotion && this.porscheMotion.owns(ref)) ||
            (this.silverNeedles && this.silverNeedles.owns(ref)) || (this.silverDigits && this.silverDigits.owns(ref));
        const starlight = this.silverStarlight && this.silverStarlight.owns(ref);
        if (this.theme === 'silver' && reason === PIXEL_MEMORY_FULL && (ref === this.ref || nativeMotion || starlight)) {
            if (this.silverBackgroundScaleIndex + 1 < SILVER_BACKGROUND_SCALES.length) {
                const scale = SILVER_BACKGROUND_SCALES[++this.silverBackgroundScaleIndex];
                this.log.warn('Rolls Royce: ' + reason + '; retrying with a ' +
                    (PANEL_WIDTH * scale) + 'x' + (PANEL_HEIGHT * scale) + ' background');
                this.recover();
                return true;
            }
            if (!starlight) {
                this.log.warn('Rolls Royce: ' + reason);
                this.recover('BMW original · Waiting for renderer memory');
                return true;
            }
        }
        if (nativeMotion) {
            this.rejectNativeMotion(reason);
            return true;
        }
        if (starlight) {
            this.disableStarlight(reason);
            return true;
        }
        return false;
    }

    disableStarlight(reason) {
        this.log.warn('Rolls Royce Starlight unavailable: ' + reason);
        this.silverStarlight.drop();
        this.silverStarlight = null;
        this.starlightFailed = true;
        if (this.layerState === 'shown') this.reportActive();
    }

    prepareSilverMotion() {
        if (!this.silverNeedles) this.silverNeedles = new SilverNeedles(this.client);
        if (!this.silverNeedles.prepare(this.choices)) {
            this.rejectNativeMotion('could not prepare the needle images');
            return false;
        }
        if (!this.silverDigits) {
            this.silverDigits = new SilverDigits(this.client);
            if (!this.silverDigits.prepare()) {
                this.rejectNativeMotion('could not prepare the digit glyphs');
                return false;
            }
        }
        if (this.choices.needleEffect === 'starlight' && !this.starlightFailed && !this.silverStarlight) {
            this.silverStarlight = new SilverStarlight(this.client);
            if (!this.silverStarlight.prepare()) this.disableStarlight('could not prepare the trail layers');
            else this.silverStarlight.update(this.car.motion().speed, this.layerState === 'shown', Date.now());
        }
        if (this.choices.needleEffect !== 'starlight' && this.silverStarlight) {
            this.silverStarlight.drop();
            this.silverStarlight = null;
        }
        return true;
    }

    draw() {
        if (!this.client || !this.connected || this.theme === 'stock') return;
        const now = Date.now();
        if (this.client.blocked) {
            if (this.blockedSince === null) this.blockedSince = now;
            if (this.layerState === 'shown' && now - this.blockedSince >= MAX_SOCKET_BLOCK_MS) {
                this.log.warn('Cluster renderer cannot accept current instrument readings; releasing the panel');
                this.recover();
            }
            return;
        }
        this.blockedSince = null;
        try {
            if (now - this.lastDrawAt < DRAW_INTERVAL_MS) return this.sendNativeMotion(now);
            this.lastDrawAt = now;
            const data = this.car.snapshot();
            if (this.theme === 'vdoRetro') data.turnLamp = this.car.turnIndicator.lit(now);
            // The speed text uses whole km/h. Avoid repainting the panel for
            // fluctuations that do not change the displayed reading.
            if (this.theme !== 'vdoRetro' && Number.isFinite(data.speed)) data.speed = Math.round(data.speed);
            data.clock = clusterClock(this.settings, now);
            const panelAvailable = this.layerState !== 'suspended' && this.layerState !== 'hidden';
            data.mapSlot = panelAvailable ? this.map.update(this.choices, this.theme) : null;
            const mediaVisible = SLOTS.some((slot) => this.choices[slot] === 'media' ||
                (this.choices[slot] === 'waze' && this.choices.fallback === 'media' && slot !== data.mapSlot));
            if (panelAvailable && mediaVisible && data.media && !data.media.artwork &&
                this.settings.get('onlineCoverArt') === true) {
                data.media = withArtwork(data.media, this.onlineArtwork.get(data.media, now), 'online');
            }
            this.setMapMessage(panelAvailable ? this.map.message : '');
            // The native BMW map can still display while Waze waits or uses the stock map slot.
            if (this.theme === 'wazeFull' && data.mapSlot !== 'fullMap') {
                this.dropPanelImage();
                this.report('BMW original active');
                return;
            }
            const scale = SILVER_BACKGROUND_SCALES[this.silverBackgroundScaleIndex];
            const iw = PANEL_WIDTH * scale;
            const ih = PANEL_HEIGHT * scale;
            if (!this.ref) {
                this.ref = this.client.image({
                    target: 'panel', klass: 'overlay', x: 0, y: 0, w: PANEL_WIDTH, h: PANEL_HEIGHT,
                    iw, ih, sampling: scale === 1 ? 'nearest' : 'bilinear', contend: false, fps: PANEL_FPS,
                });
                if (!this.ref) return this.recover();
            }
            const native = Boolean(NATIVE_THEMES[this.theme]);
            if (this.theme === 'silver' && !this.prepareSilverMotion()) return;
            if (this.theme === 'five') {
                if (!this.porscheMotion) this.porscheMotion = new PorscheMotion(this.client);
                if (!this.porscheMotion.prepare(this.choices)) return this.rejectNativeMotion('could not prepare Porsche motion layers');
            }
            const backgroundData = native
                ? Object.assign({}, data, { speed: undefined, rpm: undefined }) : data;
            const signature = JSON.stringify([this.theme, this.choices, backgroundData]);
            if (this.layerState === 'shown') this.sendNativeMotion(now);
            if (signature !== this.lastFrame) {
                const canvas = this.scratchPixels || new Canvas(iw, ih);
                const frame = renderPanelFrame(this.theme, this.choices, data, false, canvas,
                    this.faceCache, null, { nativeNeedles: native, nativeDigits: native });
                if (!sendPanelFrame(this.client, this.ref, frame, this.lastPixels)) return;
                this.scratchPixels = this.lastPixels;
                this.lastPixels = frame;
                this.lastFrame = signature;
            }
        } catch (error) {
            this.log.warn('cluster theme draw: ' + (error && error.message || error));
            this.recover();
        }
    }

    recover(message = 'Theme interrupted; reconnecting automatically') {
        const delay = RECOVERY_DELAYS_MS[Math.min(this.failures++, RECOVERY_DELAYS_MS.length - 1)];
        this.retryAt = Date.now() + delay;
        this.releaseClient();
        this.report(message);
    }

    releaseClient() {
        this.engineReadings.cancel();
        if (this.motionTimer) clearTimeout(this.motionTimer);
        this.motionTimer = null;
        if (this.nativeMotionTimer) clearTimeout(this.nativeMotionTimer);
        this.nativeMotionTimer = null;
        this.lastNativeMotionAt = -Infinity;
        this.nextMotionLogAt = 0;
        this.lastDrawAt = -Infinity;
        const client = this.client;
        this.client = null;
        this.ref = null;
        this.connected = false;
        this.lastFrame = null;
        this.lastPixels = null;
        this.scratchPixels = null;
        this.faceCache = {};
        this.porscheMotion = null;
        this.silverNeedles = null;
        this.silverDigits = null;
        this.silverStarlight = null;
        this.starlightFailed = false;
        this.blockedSince = null;
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
        this.silverBackgroundScaleIndex = 0;
        this.nativeMotionFailed = false;
        this.liveSince = null;
        this.missingSince = null;
        this.releaseClient();
        this.report('BMW original active');
    }

    destroy() {
        this.destroyed = true;
        this.stop();
    }
}

module.exports = { ClusterService };
