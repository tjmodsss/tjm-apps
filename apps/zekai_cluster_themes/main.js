'use strict';

const mgu = require('./kit/mgu');
const { ClusterService } = require('./cluster-service');
const { panel, SLOTS, SILVER_SLOTS, NAMES, DEMO, PALETTES } = require('./dials');
const { SILVER_PALETTES, updateSilverTrail } = require('./silver-dials');
const { wazeFullPanel } = require('./waze-full-screen');
const { vdoPanel } = require('./vdo-retro');
const { PANEL_WIDTH, PANEL_HEIGHT, panelLayout } = require('./panel-layout');
const { clusterClock } = require('./cluster-clock');

const THEMES = [['stock', 'BMW original'], ['five', 'Porsche'], ['silver', 'Rolls Royce'], ['digital', 'Digital'], ['wazeFull', 'Waze Full Map'], ['vdoRetro', 'VW 2000']];
const SLOT_LABELS = ['Left outer', 'Left inner', 'Right inner', 'Right outer'];

function settingSwatch(key, value) {
    if (key === 'silver_faceColour') return SILVER_PALETTES[value].rim;
    if (key === 'five_faceColour') {
        const palette = PALETTES[value];
        return palette.centreRing || (palette.centreFace || [])[2] || palette.ring;
    }
}

mgu.run({
    settingSwatch,
    background(context) {
        return new ClusterService(context);
    },
    start(ctx) {
        const { ui, settings, background } = ctx;

        function choice(key) {
            const item = settings.item(key);
            const value = settings.get(key);
            return item.options.some(([id]) => id === value) ? value : item.default;
        }

        function selections(theme) {
            if (theme === 'stock' || theme === 'vdoRetro') return {};
            if (theme === 'wazeFull') return { mapMode: 'full' };
            const slots = {};
            const keys = theme === 'silver' ? SILVER_SLOTS : SLOTS;
            for (const key of keys.concat('fallback')) slots[key] = choice(theme + '_' + key);
            if (theme === 'silver') {
                slots.faceColour = choice('silver_faceColour');
                slots.needleEffect = choice('silver_needleEffect');
            }
            if (theme === 'five') {
                slots.faceColour = choice('five_faceColour');
                slots.speedPosition = choice('five_speedPosition');
                slots.fullRangeKm = choice('five_fullRangeKm');
            }
            return slots;
        }

        function apply() {
            settings.set('clusterOverlayEnabled', true);
            if (background) background.retryNativeMotion();
        }
        function restore() { settings.set('clusterOverlayEnabled', false); }

        const loop = ctx.loop('MAIN', 8, render);
        let last = '';
        let previewTrail = null;
        function render() {
            const theme = choice('instrumentTheme');
            const slots = selections(theme);
            const clock = clusterClock(settings);
            const status = background ? background.status() : 'Background cluster service unavailable';
            const starlight = theme === 'silver' && slots.needleEffect === 'starlight';
            const previewAt = starlight ? Math.floor(Date.now() / 125) * 125 : null;
            const signature = JSON.stringify([theme, slots, status, clock, previewAt]);
            if (signature === last) return;
            last = signature;
            if (!starlight) previewTrail = null;
            const cv = ctx.canvas(1600, 520);
            const label = (str, x, y, size, color = '#e9f1ff') => cv.text(str, x, y, size, color, { literal: true });
            const chevron = (x, y) => {
                cv.line(x, y - 5, x + 5, y, 1.5, '#a9bed7');
                cv.line(x + 5, y, x, y + 5, 1.5, '#a9bed7');
            };
            cv.fillRect(0, 0, 1600, 520, '#0b1018');
            cv.roundRect(16, 18, 304, 478, 16, '#161f2e');
            label('THEMES', 40, 61, 24, '#a9ccf1');
            THEMES.forEach(([id, title], i) => {
                const y = 81 + i * 35;
                cv.roundRect(38, y, 260, 31, 7, id === theme ? '#2a4562' : '#202b3a');
                label(title, 57, y + 22, 18);
                cv.target(38, y, 260, 31, () => settings.set('instrumentTheme', id), 'theme:' + id, 9);
            });
            const appearanceCard = (key, title, value, y) => {
                const labelText = settings.item(key).options.find(([id]) => id === value)[1];
                cv.roundRect(38, y, 260, 52, 9, '#202b3a');
                label(title, 52, y + 19, 14, '#b4c2d6');
                label(labelText, 52, y + 43, 21);
                const swatch = settingSwatch(key, value);
                if (swatch) cv.circle(256, y + 28, 8, swatch);
                chevron(279, y + 28);
                cv.target(38, y, 260, 52, () => ctx.openSetting(key), key, 9);
            };
            if (theme === 'silver') {
                appearanceCard('silver_faceColour', 'FACE COLOUR', slots.faceColour, 306);
                appearanceCard('silver_needleEffect', 'NEEDLE EFFECT', slots.needleEffect, 364);
            }
            if (theme === 'five') {
                appearanceCard('five_faceColour', 'FACE COLOUR', slots.faceColour, 306);
                appearanceCard('five_speedPosition', 'DIGITAL SPEED', slots.speedPosition, 364);
                cv.roundRect(38, 418, 260, 34, 7, '#202b3a');
                label('Restore Porsche layout', 52, 441, 18);
                cv.target(38, 418, 260, 34, () => {
                    for (const key of SLOTS.map((slot) => 'five_' + slot).concat('five_speedPosition')) {
                        const value = settings.item(key).default;
                        if (settings.get(key) !== value) settings.set(key, value);
                    }
                }, 'porsche:restoreLayout', 9);
            }
            if (theme !== 'five') label('G05 / iDrive 7', 40, 445, 24);
            label('Auto-start • persistent display', 40, 473, 17, '#adbcd2');

            cv.roundRect(338, 18, 1245, 478, 16, '#161f2e');
            label('Instrument preview', 362, 58, 26);
            label('SIMULATED DATA', 1351, 58, 18, '#a9ccf1');
            cv.roundRect(359, 77, 1202, 298, 11, '#030507');
            if (theme === 'wazeFull') {
                wazeFullPanel(cv, Object.assign({}, DEMO, { speed: 84, rpm: 2100, coolant: 91, oil: 98, stage: 'D', clock }), {
                    demo: true, x: 359, y: 77, w: 1202, h: 298,
                });
            } else if (['five', 'silver', 'vdoRetro'].includes(theme)) {
                const layout = panelLayout(theme);
                const fit = 298 / PANEL_HEIGHT;
                const opts = {
                    demo: true, background: false, clock,
                    x: 960 - PANEL_WIDTH * fit / 2 + layout.x * fit,
                    y: 77 + layout.y * fit,
                    scale: layout.scale * fit,
                };
                if (starlight) {
                    opts.previewSpeed = Math.round(84 + 49 * Math.sin(previewAt / 2350));
                    if (!previewTrail) previewTrail = {};
                    opts.needleTrail = updateSilverTrail(previewTrail, opts.previewSpeed, previewAt);
                }
                if (theme === 'vdoRetro') {
                    vdoPanel(cv, Object.assign({}, DEMO, {
                        speed: 68, rpm: 1850, coolant: 91, oil: 98, ambient: 15,
                        economyMpgUs: 29.4, odometerKm: 152112, tripKm: 6.8, fuelLitres: 41,
                    }), opts);
                } else {
                    const data = theme === 'five' ? Object.assign({}, DEMO, { rpm: 810, coolant: 91, oil: 103 }) : DEMO;
                    panel(cv, theme, slots, data, opts);
                }
            } else {
                panel(cv, theme, slots, DEMO, { demo: true, x: 514, y: 78, scale: 0.92, clock });
            }
            const readouts = theme === 'vdoRetro' ? [['Speed', 'MPH + km/h dual scale'], ['Engine', 'RPM / fuel / coolant'], ['Trip', 'Odometer / trip / AVG MPG']]
                : theme === 'wazeFull' ? [['Map', 'Full instrument display'], ['Top', 'Speed + time + gear'], ['Bottom', 'Range + RPM + temperatures']]
                : theme === 'silver' ? [
                    ['Left dial', NAMES[slots.leftInner], 'leftInner'],
                    ['Centre dial', 'Vehicle speed'],
                    ['Right dial', NAMES[slots.rightInner], 'rightInner'],
                ]
                : SLOTS.map((key, i) => [SLOT_LABELS[i], NAMES[slots[key]] || 'BMW original', key]);
            const column = Math.floor(1212 / readouts.length);
            readouts.forEach(([title, value, key], i) => {
                const x = 359 + i * column;
                cv.roundRect(x, 387, column - 11, 62, 9, '#223045');
                label(title, x + 13, 407, 17, '#b4c2d6');
                label(value, x + 13, 435, 23);
                if (!['stock', 'wazeFull', 'vdoRetro'].includes(theme) && key) {
                    chevron(x + column - 35, 418);
                    cv.target(x, 387, column - 11, 62, () => ctx.openSetting(theme + '_' + key), 'slot:' + key, 9);
                }
            });
            const statusWidth = cv.textWidth(status, 22, { literal: true });
            label(status, 361, 480, statusWidth > 1180 ? 22 * 1180 / statusWidth : 22, '#a9ccf1');
            return ui.image('MAIN_GFX', cv);
        }

        function refresh() {
            last = '';
            loop.kick();
        }

        if (background && background.on) background.on('status', refresh);
        settings.onChange(refresh);
        ctx.onLayout(refresh);
        ui.onVisible((name, visible) => {
            if (name !== 'MAIN') return;
            if (!visible) previewTrail = null;
            refresh();
        });
        ui.onClick('BTN_APPLY', apply);
        ui.onClick('BTN_RESTORE', restore);
        refresh();
    },
});
