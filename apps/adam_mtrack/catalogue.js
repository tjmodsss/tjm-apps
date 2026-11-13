'use strict';
/**
 * catalogue.js - every widget a side panel can show (the 22 of iDrive-Apps docs/reference/mtrack/PANELS.md, and
 * Empty). Pure data, Node 8.
 *   kind: 'whole' takes the panel's two halves, 'half' one half.
 *   needs: the interfaces it reads (a widget whose interfaces are all unavailable is greyed in the picker).
 *   inApp: false = no car signal in this app (the diagnostic link or no source): hidden from the picker, a saved
 *          one falls back to the setting's default.
 *   draw: the widgets.js renderer.
 * Descriptions are one line, ASCII (the centre screen's fonts).
 */
const CDS = 'de.bmw.infotainment.vehicle.CDS';
const CDS2 = 'de.bmw.infotainment.vehicle.CDS2';
const FES = 'de.bmw.infotainment.drivingexcitement.FES';
const TPMS = 'de.bmw.infotainment.vehicle.TPMS';
const KOMBI = 'de.bmw.infotainment.KombiIF';
const V2 = 'de.bmw.infotainment.vehicle.Vehicle2';

const W = (id, label, kind, desc, needs, inApp, draw) => ({ id, label, kind, desc, needs, inApp, draw });

const CATALOGUE = [
    W('tyres', 'Tyre data', 'whole', 'Pressures and temperatures, all four tyres', [TPMS], true, 'tyres'),
    W('gforce', 'G-meter', 'whole', 'Live g with the peaks of this drive', [CDS2], true, 'gmeter'),
    W('trip', 'Trip data', 'whole', 'Distance, time, average speed and mpg', [KOMBI], true, 'rows'),
    W('consumption', 'Consumption', 'half', 'Average fuel use from the trip computer', [KOMBI], true, 'rows'),
    W('media', 'Entertainment', 'whole', 'Not in 0.1.0: no media signal for apps', [], false, 'none'),
    W('modecol', 'Drive-mode column', 'whole', 'The car\'s drive mode, BMW M SETUP style', [FES], true, 'modes'),
    W('coolant', 'Coolant temperature', 'half', 'Coolant, with the hot zone', [CDS], true, 'bar'),
    W('boost', 'Boost', 'half', 'Boost from the sport display (scale a best guess)', [FES], true, 'bar'),
    W('torque', 'Torque', 'half', 'Engine torque from the engine unit', [FES], true, 'bar'),
    W('power', 'Power', 'half', 'Worked out from torque and rpm', [FES], true, 'bar'),
    W('oil', 'Oil temperature', 'half', 'Engine oil, with the hot zone', [CDS], true, 'bar'),
    W('fuel', 'Fuel level', 'half', 'Tank level, 0 to full', [KOMBI], true, 'bar'),
    W('range', 'Range', 'half', 'Range left from the cluster\'s estimate', [KOMBI], true, 'rows'),
    W('iat', 'Intake air temperature', 'half', 'Not in 0.1.0: needs the engine unit link', [], false, 'none'),
    W('oilpress', 'Oil pressure', 'half', 'Not in 0.1.0: needs the engine unit link', [], false, 'none'),
    W('trans', 'Gearbox oil temperature', 'half', 'Not in 0.1.0: needs the gearbox link', [], false, 'none'),
    W('xdrive', 'xDrive split', 'half', 'Not in 0.1.0: needs the transfer case link', [], false, 'none'),
    W('volt', 'Battery voltage', 'half', 'Not in 0.1.0: needs the engine unit link', [], false, 'none'),
    W('timer', '0-60 mph timer', 'half', 'Times 0-60 mph from the speed, last and best', [V2], true, 'rows'),
    W('dyno', 'Dyno peak', 'half', 'Not in 0.1.0: needs weight and drag settings', [], false, 'none'),
    W('warmup', 'Warm-up', 'half', 'Oil temperature against full revs', [CDS], true, 'rows'),
    W('service', 'Service due', 'half', 'Not in 0.1.0: the service list is not read', [], false, 'none'),
    W('none', 'Empty', 'half', 'Nothing: the half stays empty', [], true, 'none'),
];

const BY_ID = Object.create(null);
CATALOGUE.forEach((w) => { BY_ID[w.id] = w; });

/** Widget id, or undefined. */
const get = (id) => (typeof id === 'string' && Object.prototype.hasOwnProperty.call(BY_ID, id) ? BY_ID[id] : undefined);
const ids = () => CATALOGUE.map((w) => w.id);
const selectable = () => CATALOGUE.filter((w) => w.inApp).map((w) => w.id);
const hidden = () => CATALOGUE.filter((w) => !w.inApp).map((w) => w.id);

module.exports = { CATALOGUE, get, ids, selectable, hidden, IFACES: { CDS, CDS2, FES, TPMS, KOMBI, V2 } };
