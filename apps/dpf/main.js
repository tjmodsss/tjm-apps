'use strict';

/**
 * DPF Status
 *
 * Read-only DDE monitor. Identifies DDE 0x12 via physical UDS 22 F1 50.
 * DPF measurements remain unavailable
 * until their B57/DDE 8.32 identifiers and decoding have been verified.
 *
 * No diagnostic service other than the read-only services exposed by
 * ReadOnlyDiag can be sent by this app.
 */
const mgu = require('./kit/mgu');
const { ReadOnlyDiag } = require('./kit/readonly-diag');

const W = 1600;
const H = 520;

mgu.run({
    async start(ctx) {
        const { ui, log } = ctx;
        let transportStatus = 'NOT STARTED';
        const link = new ReadOnlyDiag(ctx.signals, log, {
            gapMs: 50, busyMs: 500,
            onDebug: message => {
                if (/^(SENDING|TRANSPORT|FRAME|NO MATCHING RESPONSE|REPLY|SKIPPED)/.test(message)) {
                    transportStatus = message.slice(0, 100);
                    log.info('DPF TASU ' + transportStatus);
                }
            }
        });
        const DDE = 0x12;
        const EXPECTED = '0F1FE8';
        let scanState = 'CONNECTING';
        let scanError = '';
        let identified = false;
        let testing = false;
        let testLines = [];
        let testProgress = '';
        const readings = {};
        let lastReadAt = 0;
        const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
        const requestOptions = { maxRetries: 2, retryBaseMs: 500, callTimeoutMs: 2500, hardTimeoutMs: 6500, pendingTimeoutMs: 2500 };
        const dids = [['SOOT',0x44BE,2,0.01525902],['ASH',0x44BD,2,0.01525902],['SINCE',0x44BF,4,1],['AVERAGE',0x4B2F,4,1]];
        const hexBytes = a => a.map(b=>b.toString(16).toUpperCase().padStart(2,'0')).join(' ');
        async function testSelected() {
            if(testing || !identified) return;
            testing = true;
            testLines = [];
            testProgress = 'STARTING';
            const address = DDE;
            link.wake(address);
            try {
                for(const [name,did,len,factor] of dids) {
                    testProgress = 'READING '+name+' '+did.toString(16).toUpperCase();
                    const response = await link.physical(address, 0x22, [(did >> 8) & 255, did & 255], 1800,
                        u => u && ((u[0] === 0x62 && u[1] === (did >> 8) && u[2] === (did & 255)) || (u[0] === 0x7F && u[1] === 0x22)),
                        requestOptions);
                    let result = 'TIMEOUT';
                    if(response) {
                        if(response[0] === 0x7F) result = 'NRC '+hexBytes(response);
                        else if(response[0] === 0x62 && response[1] === (did>>8) && response[2] === (did&255)) {
                            const bytes = response.slice(3);
                            if(bytes.length === len) {
                                let raw = 0;
                                for(const b of bytes) raw = raw*256+b;
                                result = hexBytes(bytes)+' = '+(raw*factor).toFixed(factor===1?0:2);
                            } else result = 'LEN '+bytes.length+' '+hexBytes(bytes);
                        } else result = 'UNEXPECTED '+hexBytes(response);
                    }
                    if (response && response[0] === 0x62 && response[1] === (did >> 8) && response[2] === (did & 255) && response.length === len + 3) {
                        let raw = 0;
                        for (const b of response.slice(3)) raw = raw * 256 + b;
                        readings[name] = { raw, value: raw * factor, at: Date.now() };
                    }
                    const line = name+' '+did.toString(16).toUpperCase()+': '+result;
                    testLines.push(line);
                    testProgress = 'DONE '+testLines.length+'/'+dids.length;
                    log.info('DPF READ ECU '+address.toString(16)+' '+line);
                }
            } catch(e) {testLines.push('ERROR: '+String(e).slice(0,95));log.warn('DPF test: '+String(e));}
            finally {testing = false;testProgress = 'TEST FINISHED '+testLines.length+'/'+dids.length;}
        }


        const identify = async () => {
            scanState = 'IDENTIFYING DDE';
            scanError = '';
            transportStatus = 'STARTING IDENTIFICATION';
            identified = false;
            try {
                if (!link.ready) await link.init();
                if (!link.available) {
                    scanState = 'NO DIAGNOSTIC LINK';
                    scanError = link.error || 'TASU unavailable';
                    return;
                }
                link.wake(DDE);
                const u = await link.physical(DDE, 0x22, [0xF1, 0x50], 1800,
                    b => b && ((b[0] === 0x62 && b[1] === 0xF1 && b[2] === 0x50) || (b[0] === 0x7F && b[1] === 0x22)),
                    requestOptions);
                if (!u) { scanState = 'DDE NO RESPONSE'; return; }
                if (u[0] !== 0x62 || u.length < 6) {
                    scanState = 'DDE IDENTIFICATION REFUSED';
                    scanError = hexBytes(u);
                    return;
                }
                const actual = hexBytes(u.slice(3, 6)).replace(/ /g, '');
                if (actual !== EXPECTED) {
                    scanState = 'UNEXPECTED DDE';
                    scanError = actual + ' (expected ' + EXPECTED + ')';
                    return;
                }
                identified = true;
                scanState = 'DDE IDENTIFIED';
            } catch (e) {
                scanState = 'DDE LINK ERROR';
                scanError = String(e.message || e);
                log.warn('DPF identify: ' + scanError);
            }
        };

        function render() {
            const t = ctx.theme();
            const cv = ctx.canvas(W, H).clear(t.bg);

            cv.text('DPF STATUS', 48, 78, 32, t.text, { font: 'bold', spacing: 2 });
            cv.text('READ-ONLY DIESEL PARTICULATE FILTER MONITOR', 48, 112, 17, t.dim, {
                font: 'bold', spacing: 1
            });

            const stateColor = scanState === 'DDE IDENTIFIED' ? t.ok
                : (scanState === 'IDENTIFYING DDE' || scanState === 'CONNECTING' ? t.warn : t.dim);
            cv.roundRect(48, 145, 1504, 54, 9, t.panel || t.bg);
            cv.text(scanState, 72, 180, 23, stateColor, { font: 'bold', spacing: 1.5 });

            const fresh = key => readings[key] && Date.now() - readings[key].at < 60000;
            const number = key => fresh(key) ? readings[key].value.toFixed(2) : '--';
            const raw = key => fresh(key) ? String(readings[key].raw) : '--';
            const cards = [
                ['SOOT MASS', number('SOOT'), 'g'],
                ['ASH LOAD', number('ASH'), 'raw scaled'],
                ['SINCE REGEN · RAW', raw('SINCE'), 'unverified'],
                ['AVG REGEN · RAW', raw('AVERAGE'), 'unverified']
            ];
            const cardW = 354;
            cards.forEach((item, i) => {
                const x = 48 + i * 384;
                cv.roundRect(x, 220, cardW, 118, 10, t.panel || t.bg);
                cv.text(item[0], x + 20, 253, 16, t.dim, { font: 'bold', spacing: 1 });
                cv.text(item[1], x + 20, 310, 38, t.dim, { font: 'num' });
                if (item[2]) cv.text(item[2], x + 20, 330, 14, t.dim);
            });

            // Independent DDE flags: request pending is not the same as regeneration active.
            // Neither is inferred from soot load or temperature.
            cv.roundRect(48, 352, 736, 48, 9, t.panel || t.bg);
            cv.roundRect(816, 352, 736, 48, 9, t.panel || t.bg);
            cv.text('REGENERATION', 68, 383, 18, t.dim, { font: 'bold' });
            cv.text('UNKNOWN', 764, 383, 20, t.warn, { font: 'bold', align: 'right' });
            cv.text('REGEN REQUEST', 836, 383, 18, t.dim, { font: 'bold' });
            cv.text('UNKNOWN', 1532, 383, 20, t.warn, { font: 'bold', align: 'right' });


            cv.text('DDE READ-ONLY TEST',48,425,17,t.text,{font:'bold'});
            cv.text('DDE 0x12 / '+EXPECTED,48,451,16,t.warn);
            cv.text(testing ? testProgress : (testProgress || scanError || scanState),850,451,16,t.dim);
            cv.text(transportStatus,850,425,14,t.warn);
            testLines.forEach((line,i)=>cv.text(line,48+(i%2)*770,480+Math.floor(i/2)*24,15,t.text,{font:'num'}));
            return ui.image('MAIN_GFX', cv);
        }

        ui.onClick('BTN_TEST_DPF', () => {
            testSelected().then(render).catch(e=>log.warn('DPF test: '+e));
        });
        ctx.loop('MAIN', 4, render);
        await identify();
        // Read-only periodic updates while the page is visible; never overlap requests.
        (async () => {
            while (true) {
                await sleep(20000);
                if (identified && !testing && ui.isVisible('MAIN')) await testSelected();
            }
        })().catch(e => log.warn('DPF polling: ' + e));
        render()
            .then(() => log.info('DPF Status first frame rendered'))
            .catch((e) => log.warn('DPF Status first render: ' + e));
    }
});
