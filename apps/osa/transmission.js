'use strict';

/**
 * OSA transmission reader.
 * Reads only EGS identification (F150) and transmission oil temperature (6000).
 * Uses the shared read-only diagnostic transport; no writes or control requests.
 */
const { ReadOnlyDiag } = require('./kit/readonly-diag');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const hex = (bytes) => Array.from(bytes || []).map((b) => Number(b).toString(16).padStart(2, '0')).join('').toUpperCase();

class TransmissionReader {
    constructor(ctx) {
        this.ctx = ctx;
        this.link = null;
        this.sgbd = '';
        this.temp = null;
        this.at = 0;
        this.statusText = 'CONNECTING';
        this.error = '';
        this.visible = false;
        this.running = false;
        this.busy = false;
    }

    setVisible(on) {
        const wasVisible = this.visible;
        this.visible = !!on;
        if (!on && this.link) {
            this.link.cancel();
        } else if (on && !wasVisible && this.link) {
            // A previous visit may have marked EGS silent after transport refusals.
            // Give it another chance whenever the user returns to Transmission.
            this.link.wake(0x18);
        }
    }

    async init() {
        this.link = new ReadOnlyDiag(this.ctx.signals, this.ctx.log, {
            busyMs: 500
        });
        await this.link.init();
        this.running = true;
        this.pump().catch((e) => this.ctx.log.warn('OSA transmission reader: ' + e));
    }

    async identify() {
        const uds = await this.link.physical(0x18, 0x22, [0xF1, 0x50], 1800,
            (b) => b && ((b[0] === 0x62 && b[1] === 0xF1 && b[2] === 0x50)
                || (b[0] === 0x7F && b[1] === 0x22)),
            { maxRetries: 2, retryBaseMs: 500, callTimeoutMs: 2500, hardTimeoutMs: 6500, pendingTimeoutMs: 2500 });
        if (!uds) {
            this.statusText = 'NO EGS RESPONSE';
            return false;
        }
        if (uds[0] !== 0x62 || uds[1] !== 0xF1 || uds[2] !== 0x50 || uds.length < 6) {
            this.error = 'EGS identification refused';
            this.statusText = 'IDENTIFICATION ERROR';
            return false;
        }
        this.sgbd = hex(uds.slice(3, 6));
        if (this.sgbd !== '0F25D0') {
            this.statusText = 'UNSUPPORTED EGS';
            this.error = 'EGS ' + this.sgbd + ' is not verified';
            return false;
        }
        this.statusText = 'IDENTIFIED · 0F25D0';
        this.ctx.log.info('OSA EGS identified: ' + this.sgbd);
        return true;
    }

    async readTemperature() {
        const uds = await this.link.physical(0x18, 0x22, [0x60, 0x00], 1800,
            (b) => b && ((b[0] === 0x62 && b[1] === 0x60 && b[2] === 0x00)
                || (b[0] === 0x7F && b[1] === 0x22)),
            { maxRetries: 2, retryBaseMs: 500, callTimeoutMs: 2500, hardTimeoutMs: 6500, pendingTimeoutMs: 2500 });
        if (!uds || uds[0] !== 0x62 || uds[1] !== 0x60 || uds[2] !== 0x00 || uds.length !== 4) {
            this.statusText = 'WAITING FOR DATA';
            this.error = !uds ? 'No response from EGS' : 'Unexpected DID 6000 response';
            return;
        }
        const value = Number(uds[3]) - 40;
        if (!Number.isFinite(value) || value < -40 || value > 215) {
            this.statusText = 'INVALID DATA';
            this.error = 'DID 6000 value out of range';
            return;
        }
        this.temp = value;
        this.at = Date.now();
        this.statusText = 'LIVE';
        this.error = '';
    }

    async pump() {
        while (this.running) {
            if (!this.visible || !this.link || !this.link.available) {
                if (this.visible && this.link && !this.link.available) this.statusText = 'NO DIAGNOSTIC LINK';
                await sleep(500);
                continue;
            }
            if (this.ctx.settings.get('demo') === 'on') {
                this.statusText = 'DEMO MODE';
                await sleep(1000);
                continue;
            }
            if (this.busy) { await sleep(100); continue; }
            this.busy = true;
            try {
                if (!this.sgbd) {
                    if (await this.identify()) await this.readTemperature();
                } else if (this.sgbd === '0F25D0') {
                    await this.readTemperature();
                }
            } catch (e) {
                this.error = String(e.message || e);
                this.statusText = 'READ ERROR';
                this.ctx.log.warn('OSA EGS read: ' + this.error);
            } finally {
                this.busy = false;
            }
            await sleep(2000);
        }
    }

    get fresh() { return !!this.at && Date.now() - this.at < 10000; }
}

module.exports = TransmissionReader;
