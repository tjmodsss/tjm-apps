'use strict';

const DATA_MAX_AGE_MS = 12000;
const SPEED_MAX_AGE_MS = 1500;
const PRESSURE_UNITS = { 1: 'bar', 2: 'kPa', 3: 'psi', BAR: 'bar', KPA: 'kPa', PSI: 'psi' };
const CONSUMPTION_UNITS = {
    VERBRAUCH_IN_L_S_100KM: 'l100', VERBRAUCH_IN_MPG_UK: 'mpgUk', VERBRAUCH_IN_MPG_US: 'mpgUs', VERBRAUCH_IN_KM_S_L: 'kml',
    1: 'l100', 2: 'mpgUk', 3: 'mpgUs', 4: 'kml',
};
const MEDIA_LINE_TYPES = { 1: 'ARTIST', 2: 'ALBUM', 3: 'TITLE' };

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
    return typeof value === 'string' ? value.slice(0, 256).replace(/\s+/g, ' ').trim() : '';
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
    return title ? { title, artist: artist === title ? '' : artist } : null;
}

class Car {
    constructor(now = Date.now, onMotion = () => {}) {
        this.now = now;
        this.onMotion = onMotion;
        this.values = Object.create(null);
    }

    put(key, value) {
        const previous = this.values[key];
        this.values[key] = { value, at: this.now() };
        if ((key === 'speed' || key === 'rpm') && (!previous || previous.value !== value)) this.onMotion();
    }

    get(key, maxAge = DATA_MAX_AGE_MS) {
        const sample = this.values[key];
        const age = sample ? this.now() - sample.at : Infinity;
        return age >= 0 && age <= maxAge ? sample.value : null;
    }

    snapshot() {
        const data = {};
        for (const key of Object.keys(this.values)) {
            data[key] = this.get(key, key === 'speed' ? SPEED_MAX_AGE_MS : DATA_MAX_AGE_MS);
        }
        return data;
    }

    watch(ctx) {
        const add = (name, fields, pollMs, { instance = '1', readTimeoutMs = 1000, pollByField } = {}) =>
            ctx.signals.watch(name, instance, fields, ctx.log, {
                pollMs, readTimeoutMs, pollByField, shouldPoll: () => !ctx.ui || ctx.ui.isVisible('MAIN'),
            }).catch((error) => ctx.log.warn('Signal unavailable: ' + name + ' ' + error.message));

        add('de.bmw.infotainment.vehicle.Vehicle2', {
            statusCarSpeed2: (v) => this.put('speed', scaled(v && v.speedVehicleCentreOfGravity, 65535, 1 / 64, 0)),
        }, 150, { readTimeoutMs: 350 });
        add('de.bmw.infrastructure.VehicleInformation', {
            statusGearboxDrive: (v) => {
                const x = v && v.statusActualStageDrive;
                this.put('stage', x === 'P' || x === 1 ? 'P' : 'other');
            },
            DataPowerTrain2: (v) => {
                const x = v && v.statusGearSelectionDrive;
                this.put('selection', x === 'P' || x === 3 ? 'P' : 'other');
            },
        }, 700);
        add('de.bmw.infotainment.vehicle.CDS', {
            statusEngineSpeed2: (v) => this.put('rpm', scaled(v && v.actualValueRPMEngineCrankshaft, 65535, 0.25, 0)),
            statusEngineTemperature: (v) => {
                this.put('coolant', scaled(v && v.temperatureEngineDrive, 255, 1, -48));
                this.put('oil', scaled(v && v.temperatureEngineOilDrive, 255, 1, -48));
            },
        }, 200, { readTimeoutMs: 450, pollByField: { statusEngineTemperature: 2500 } });
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
        add('de.bmw.infotainment.vehicle.Vehicle', {
            statusNewCurrentUnitsStatusExt: (v) => this.put('pressureUnit', PRESSURE_UNITS[v && v.unitOfMeasurementAirPressure] || null),
        }, 4500);
        add('de.bmw.infotainment.vehicle.TPMS', {
            statusTyrePressure: (v) => this.put('tyres', ['FL', 'FR', 'RL', 'RR'].map((key) =>
                scaled(v && v['actualValuePressureTyre' + key + 'H'], 65532, 0.1, 0))),
        }, 5000);
        add('de.bmw.infotainment.hmi.hmimediastate.HmiMediaState', {
            playerMetadata: (value) => {
                const sink = value && value.sink;
                if (sink === undefined || sink === 0 || sink === 'FRONT' || !value) {
                    this.put('media', nowPlaying(value));
                }
            },
        }, 3000, { instance: 'HMI_CID' });
    }
}

module.exports = { Car, economyMpgUs };
