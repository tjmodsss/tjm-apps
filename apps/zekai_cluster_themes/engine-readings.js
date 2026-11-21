'use strict';

const { ReadOnlyDiag } = require('./kit/readonly-diag');
const ENGINE = 0x12;
const BATTERY_SENSOR_VOLTAGE = 0x5853;
const OIL_ABSOLUTE = 0x4436;
const AMBIENT_PRESSURE = 0x4201;
const POLL_MS = 5000;

function didValue(reply, id) {
    if (!reply || reply.length < 5 || reply[0] !== 0x62 || reply[1] !== (id >> 8) || reply[2] !== (id & 0xff)) return null;
    const raw = reply[3] * 256 + reply[4];
    return raw === 65535 ? null : raw;
}

class EngineReadings {
    constructor(context, store) {
        this.context = context;
        this.store = store;
        this.next = 0;
        this.active = false;
        this.link = null;
        this.generation = 0;
    }

    update(slots) {
        const now = Date.now();
        if (this.active || now < this.next || !this.context.signals.proxy) return;
        const battery = slots.includes('battery');
        const oil = slots.includes('oilGauges');
        if (!battery && !oil) return;
        this.next = now + POLL_MS;
        this.active = true;
        this.read(battery, oil, this.generation).catch((error) => this.context.log.warn('Porsche readings: ' + error.message))
            .then(() => { this.active = false; });
    }

    cancel() {
        this.generation++;
        if (this.link) this.link.cancel();
    }

    async read(battery, oil, generation) {
        if (!this.link) {
            this.link = new ReadOnlyDiag(this.context.signals, this.context.log);
            await this.link.init();
        }
        if (!this.link.available || generation !== this.generation) return;
        if (battery) {
            const raw = didValue(await this.link.read(ENGINE, BATTERY_SENSOR_VOLTAGE, 500), BATTERY_SENSOR_VOLTAGE);
            const volts = raw === null ? null : raw / 1000;
            if (generation !== this.generation) return;
            this.store('batteryVolts', volts !== null && volts >= 5 && volts <= 18 ? volts : null);
        }
        if (oil) {
            const abs = didValue(await this.link.read(ENGINE, OIL_ABSOLUTE, 500), OIL_ABSOLUTE);
            if (generation !== this.generation) return;
            if (abs === null) return this.store('oilPressure', null);
            const air = didValue(await this.link.read(ENGINE, AMBIENT_PRESSURE, 500), AMBIENT_PRESSURE);
            const hPa = air === null ? null : air * 0.0390625;
            const bar = hPa === null || hPa < 500 || hPa > 1100 ? null : (abs - hPa) / 1000;
            if (generation !== this.generation) return;
            this.store('oilPressure', bar !== null && bar >= -0.1 && bar <= 20 ? Math.max(0, bar) : null);
        }
    }
}

module.exports = { EngineReadings };
