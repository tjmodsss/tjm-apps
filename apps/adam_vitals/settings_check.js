'use strict';
/**
 * settings_check.js - saved settings checked against app.json (pure, Node 8, no kit).
 *
 *   clean(schema, values) -> { values, bad: [keys] }
 * A bool must be a boolean, a choice one of its option values, a number one of its steps. Anything else falls
 * back to the setting's default; a key that was saved with a bad value is listed in bad (a missing key just gets
 * its default). Keys the schema doesn't know (the kit's _themeV, _reset_*, our _settingsV) are kept as they are.
 *
 *   migrate(values, schema) -> [[key, value], ...]   the writes that move settings saved by an older version to
 * this one (empty once done). 0.1.0 saved every value (the kit writes them all with the first change), so its
 * defaults can't be told from a choice: v2 (0.2.0) moves "is warm at" for oil and coolant to the new default (220 F,
 * Adam's operating temperature) and the oil warning to 275 F (was 257 F), whatever 0.1.0 saved, once. Every other
 * saved value is kept.
 */
const SETTINGS_V = 2;
const MOVED_IN_V2 = ['warmOil', 'warmCoolant', 'oilWarn'];
function valid(s, v) {
    if (s.type === 'bool') return typeof v === 'boolean';
    if (s.type === 'choice') return (s.options || []).some((o) => o[0] === v);
    if (s.type === 'number') return (s.steps || []).indexOf(v) >= 0;
    return v !== undefined;
}

function clean(schema, values) {
    const src = values && typeof values === 'object' && !Array.isArray(values) ? values : {};
    const out = Object.assign({}, src), bad = [];
    (schema || []).forEach((s) => {
        if (!s || typeof s.key !== 'string') return;
        if (valid(s, src[s.key])) return;
        if (Object.prototype.hasOwnProperty.call(src, s.key)) bad.push(s.key);
        out[s.key] = s.default;
    });
    return { values: out, bad };
}

function migrate(values, schema) {
    const v = values && typeof values === 'object' && !Array.isArray(values) ? values : {};
    if (typeof v._settingsV === 'number' && v._settingsV >= SETTINGS_V) return [];
    const writes = [];
    MOVED_IN_V2.forEach((k) => {
        const s = (schema || []).filter((x) => x && x.key === k)[0];
        if (s && v[k] !== s.default) writes.push([k, s.default]);
    });
    return writes.concat([['_settingsV', SETTINGS_V]]);
}

module.exports = { clean, valid, migrate, SETTINGS_V };
