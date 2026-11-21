'use strict';

const { TurnIndicator } = require('./turn-indicator');
const { MediaArtwork, trackKey, front, withArtwork } = require('./media-artwork');

const DATA_MAX_AGE_MS = 12000;
const MOTION_MAX_AGE_MS = 750;
const PRESSURE_UNITS = { 1: 'bar', 2: 'kPa', 3: 'psi', BAR: 'bar', KPA: 'kPa', PSI: 'psi' };
const CONSUMPTION_UNITS = {
    VERBRAUCH_IN_L_S_100KM: 'l100', VERBRAUCH_IN_MPG_UK: 'mpgUk', VERBRAUCH_IN_MPG_US: 'mpgUs', VERBRAUCH_IN_KM_S_L: 'kml',
    1: 'l100', 2: 'mpgUk', 3: 'mpgUs', 4: 'kml',
};
const MEDIA_LINE_TYPES = { 1: 'ARTIST', 2: 'ALBUM', 3: 'TITLE' };
const STAGE_CODES = [null, 'P', 'R', 'N', 'D'];
const SELECTION_CODES = [null, 'N', 'R', 'P'];

function gearPosition(value, codes) {
    return STAGE_CODES.includes(value) ? value : (Number.isInteger(value) ? codes[value] || null : null);
}

function gearSelection(value) {
    if (/^_[1-9]$/.test(String(value)) || (Number.isInteger(value) && value >= 5 && value <= 13)) return 'D';
    return gearPosition(value, SELECTION_CODES);
}

function scaled(raw, invalid, factor, offset) {
    return Number.isInteger(raw) && raw >= 0 && raw < invalid ? raw * factor + offset : null;
}

function economyMpgUs(raw, unit) {
    const value = scaled(raw, 65535, 0.1, 0);
    const kind = CONSUMPTION_UNITS[unit];
    if (value === null || value <= 0) return null;
    if (kind === 'l100') return 235.214583 / value;
    if (kind === 'mpgUk') return value * 1.20095;
    if (kind === 'mpgUs') return value;
    if (kind === 'kml') return value * 2.35214583;
    return null;
}

function mediaLine(value) {
    if (typeof value !== 'string') return '';
    // A fixed UTF-16 string can end with an unmatched high surrogate.
    return value.slice(0, 256).replace(/[\uD800-\uDBFF]$/, '').replace(/\s+/g, ' ').trim();
}

function mediaName(value) {
    return (value || '').normalize('NFKC').toLowerCase().trim();
}

function nowPlaying(metadata) {
    if (!metadata || typeof metadata !== 'object') return null;
    const lineType = (value) => MEDIA_LINE_TYPES[value] || String(value || '').toUpperCase();
    const lines = [
        [mediaLine(metadata.firstLineText), lineType(metadata.firstLineType)],
        [mediaLine(metadata.secondLineText), lineType(metadata.secondLineType)],
    ].filter(([value]) => value);
    const pick = (predicate) => (lines.find(predicate) || [])[0] || '';
    const rows = typeof metadata.threeRowText === 'string'
        ? metadata.threeRowText.slice(0, 512).split(/[\r\n]+/).map(mediaLine).filter(Boolean) : [];
    const title = pick(([, type]) => type === 'TITLE') || rows[0] || pick(([, type]) => !type || type === '0');
    const artist = pick(([, type]) => type === 'ARTIST') || rows[1] || pick(([value]) => value !== title);
    const result = title ? { title, artist: artist === title ? '' : artist } : null;
    const album = pick(([, type]) => type === 'ALBUM');
    if (result && album) result.album = album;
    return result;
}

function carPlayTrack(value) {
    const items = Array.isArray(value) ? value : value && (value.metadata || value.items);
    if (!Array.isArray(items)) return null;
    const read = (name) => {
        const ids = { TITLE: 3, ARTIST: 5, ALBUM: 7 };
        const item = items.find((entry) => {
            if (!entry) return false;
            const key = entry.key === undefined ? entry.type : entry.key;
            return String(key).toUpperCase() === name || String(key) === String(ids[name]);
        });
        const text = item && item.value;
        return mediaLine(typeof text === 'string' ? text : text && text.stringValue);
    };
    const title = read('TITLE');
    if (!title) return null;
    const album = read('ALBUM');
    const result = { title, artist: read('ARTIST') || album, source: 'CarPlay' };
    if (album) result.album = album;
    return result;
}

class Car {
    constructor(now = Date.now, onMotion = () => {}) {
        this.now = now;
        this.onMotion = onMotion;
        this.values = Object.create(null);
        this.gearField = 'stage';
        this.motionStats = { speed: { notifications: 0, reads: 0 }, rpm: { notifications: 0, reads: 0 } };
        this.turnIndicator = new TurnIndicator(now);
        this.mediaArtwork = new MediaArtwork();
    }

    put(key, value) {
        const previous = this.values[key];
        const isGear = key === 'stage' || key === 'selection';
        const previousGear = isGear ? this.gear() : null;
        if (key === 'speed' && value > 0 && this.gear() === 'P') value = null;
        this.values[key] = { value, at: this.now() };
        if (isGear && value) this.gearField = key;
        if (isGear && previousGear !== 'P' && this.gear() === 'P' && this.get('speed', MOTION_MAX_AGE_MS) > 0) {
            // Discard speed from before Park so it cannot return when leaving Park.
            this.put('speed', null);
        } else if (isGear ? previousGear !== this.gear() :
            ((key === 'speed' || key === 'rpm') && (!previous || previous.value !== value))) {
            this.onMotion();
        }
    }

    gear() {
        const { stage, selection } = this.values;
        const preferred = this.values[this.gearField];
        return preferred && preferred.value || stage && stage.value || selection && selection.value || null;
    }

    get(key, maxAge = DATA_MAX_AGE_MS) {
        const sample = this.values[key];
        const age = sample ? this.now() - sample.at : Infinity;
        return age >= 0 && age <= maxAge ? sample.value : null;
    }

    snapshot() {
        const data = {};
        for (const key of Object.keys(this.values)) {
            if (key === 'carPlay' || key === 'carPlayState' || key === 'hmiTrack') continue;
            // These values can stay unchanged between vehicle notifications.
            data[key] = key === 'odometerKm' || key === 'stage' || key === 'selection' ? this.values[key].value
                : this.get(key, key === 'speed' || key === 'rpm' ? MOTION_MAX_AGE_MS : DATA_MAX_AGE_MS);
        }
        if (data.stage !== undefined || data.selection !== undefined) data.stage = this.gear();
        const state = this.get('carPlayState');
        const track = this.get('carPlay');
        const hmi = data.media;
        if (track && (state === 'PLAY' || (state !== 'STOP' && !hmi))) data.media = track;
        if (data.media && hmi) {
            const sameSong = mediaName(hmi.title) === mediaName(data.media.title) &&
                (mediaName(hmi.artist) === mediaName(data.media.artist) ||
                    mediaName(hmi.artist).startsWith(mediaName(data.media.artist) + ' - ') ||
                    mediaName(data.media.artist).startsWith(mediaName(hmi.artist) + ' - '));
            if (data.media === hmi || sameSong) {
                data.media = withArtwork(data.media, this.mediaArtwork.get(this.get('hmiTrack')));
            }
        }
        return data;
    }

    motion() {
        return { speed: this.get('speed', MOTION_MAX_AGE_MS), rpm: this.get('rpm', MOTION_MAX_AGE_MS) };
    }

    receiveMotion(key, value, source) {
        const stats = this.motionStats[key];
        if (source === 'notification') stats.notifications++;
        else if (source === 'getter') stats.reads++;
        this.put(key, value);
    }

    takeMotionStats() {
        return ['speed', 'rpm'].map((key) => {
            const stats = this.motionStats[key];
            const sample = this.values[key];
            const age = sample && Number.isFinite(sample.value) ? this.now() - sample.at + ' ms' : 'missing';
            const summary = key + ' ' + stats.notifications + ' notifications, ' + stats.reads + ' reads, age ' + age;
            stats.notifications = 0;
            stats.reads = 0;
            return summary;
        }).join(' | ');
    }

    watch(ctx) {
        const add = (name, fields, pollMs, { instance = '1', readTimeoutMs = 1000, pollByField, onUnavailable, notifyFreshMs } = {}) =>
            ctx.signals.watch(name, instance, fields, ctx.log, {
                pollMs, readTimeoutMs, pollByField, onUnavailable, notifyFreshMs,
            }).catch((error) => ctx.log.warn('Signal unavailable: ' + name + ' ' + error.message));

        add('de.bmw.infotainment.vehicle.Vehicle2', {
            statusCarSpeed2: (v, source) => this.receiveMotion('speed', scaled(v && v.speedVehicleCentreOfGravity, 65535, 1 / 64, 0), source),
        }, 100, {
            readTimeoutMs: 250, notifyFreshMs: { statusCarSpeed2: 300 },
            onUnavailable: () => this.put('speed', null),
        });
        add('de.bmw.infotainment.vehicle.CDS', {
            statusEngineSpeed2: (v, source) => this.receiveMotion('rpm', scaled(v && v.actualValueRPMEngineCrankshaft, 65535, 0.25, 0), source),
            statusEngineTemperature: (v) => {
                this.put('coolant', scaled(v && v.temperatureEngineDrive, 255, 1, -48));
                this.put('oil', scaled(v && v.temperatureEngineOilDrive, 255, 1, -48));
            },
            statusBattery2: (v) => this.put('batteryCharge', scaled(v && v.conditionBatteryChargingCondition, 101, 1, 0)),
        }, 100, {
            readTimeoutMs: 250, notifyFreshMs: { statusEngineSpeed2: 300 },
            pollByField: { statusEngineTemperature: 2500, statusBattery2: 4500 },
            onUnavailable: () => this.put('rpm', null),
        });
        add('de.bmw.infrastructure.VehicleInformation', {
            statusGearboxDrive: (v) => {
                const stage = gearPosition(v && v.statusActualStageDrive, STAGE_CODES);
                if (stage) this.put('stage', stage);
            },
            DataPowerTrain2: (v) => {
                const selection = gearSelection(v && v.statusGearSelectionDrive);
                if (selection) this.put('selection', selection);
            },
        }, 700, {
            onUnavailable: () => {
                this.put('stage', null);
                this.put('selection', null);
            },
        });
        add('de.bmw.infotainment.KombiIF', {
            statusRangeTankStatus: (v) => {
                this.put('range', scaled(v && v.range, 4095, 1, 0));
                this.put('fuelLitres', scaled(v && v.fluidLevelFuelTank, 255, 1, 0));
                this.put('odometerKm', scaled(v && v.mileageKilometre, 16777215, 1, 0));
            },
            statusBordcomputerAverage: (v) => this.put('economyMpgUs', economyMpgUs(
                v && v.consumptionAverage1BC1, v && v.statusUnitOfMeasurementConsumptionBC)),
            statusBordcomputerTravelData: (v) => this.put('tripKm', scaled(v && v.wayPassed, 65535, 1, 0)),
        }, 4500);
        add('de.bmw.infrastructure.EnvironmentalInformation', {
            ExteriorTemperature: (v) => this.put('ambient', scaled(v && v.temperatureExterior, 255, 0.5, -40)),
        }, 4500);
        add('de.bmw.body.Light', {
            StatusFunctionsIndicators: (v) => this.turnIndicator.lightFunction(v),
            StatusFunctionsIndicators2: (v) => this.turnIndicator.lightFunction(v),
        }, 0, { onUnavailable: () => this.turnIndicator.reset() });
        add('de.bmw.infotainment.vehicle.Vehicle', {
            statusNewCurrentUnitsStatusExt: (v) => this.put('pressureUnit', PRESSURE_UNITS[v && v.unitOfMeasurementAirPressure] || null),
        }, 4500);
        add('de.bmw.infotainment.vehicle.TPMS', {
            statusTyrePressure: (v) => this.put('tyres', ['FL', 'FR', 'RL', 'RR'].map((key) =>
                scaled(v && v['actualValuePressureTyre' + key + 'H'], 65532, 0.1, 0))),
        }, 5000);
        add('de.bmw.infotainment.hmi.hmimediastate.HmiMediaState', {
            playerMetadata: (value) => {
                if (front(value)) {
                    this.put('media', nowPlaying(value));
                    this.put('hmiTrack', trackKey(value));
                }
            },
            coverArt: (value) => this.mediaArtwork.receive(value),
        }, 3000, { instance: 'HMI_CID', pollByField: { coverArt: 30000 } });
        add('de.bmw.infotainment.entertainment.mediaplayer.MediaPlayer', {
            currentItemMetadata: (value) => this.put('carPlay', carPlayTrack(value)),
            playerState: (value) => {
                const state = value && typeof value === 'object' ? (value.state || value.playerState) : value;
                const match = /(?:^|_)(PLAY|PAUSE|STOP|STOPPED)$/i.exec(String(state));
                this.put('carPlayState', match ? match[1].toUpperCase().replace('STOPPED', 'STOP') : null);
            },
        }, 2500, { instance: 'CarPlayMedia' });
    }
}

module.exports = { Car, economyMpgUs };
