'use strict';

const { t, setRuntimeTranslations } = require('./kit/i18n');
const idriveLanguage = require('./kit/idrive-language');
const catalogs = require('./locales');

function start(ctx) {
    const { ui, settings, log } = ctx;
    const languageSetting = settings.item('language');
    const languages = languageSetting.options.map(option => option.slice());
    const nativeButtons = {
        BTN_PAGE: 'Next page',
        BTN_PREV: 'Previous page',
        BTN_SETTINGS: 'Settings',
    };
    let detected = 'en';
    let language = 'en';

    function apply() {
        const preference = settings.get('language');
        const requested = preference === 'auto' ? detected : preference;
        const catalog = Object.prototype.hasOwnProperty.call(catalogs, requested) ? catalogs[requested] : null;
        language = catalog ? requested : 'en';
        setRuntimeTranslations(catalog);
        languageSetting.options = languages.map(([code, label]) =>
            code === detected ? ['auto', label + ' (auto)'] : [code, label]);
        for (const [button, label] of Object.entries(nativeButtons)) ui.text(button, t(label));
        languageSetting.options.forEach(([, label], index) => {
            ui.text('SET_LANGUAGE', label, index, 'ItemText');
        });
        if (preference === detected) settings.set('language', 'auto');
        const selected = languageSetting.options.findIndex(([code]) => code === settings.get('language'));
        ui.selected('SET_LANGUAGE', Math.max(0, selected));

        for (const setting of settings.schema) {
            if (setting.hidden) continue;
            const component = ui.comp('SET_' + setting.key.toUpperCase());
            if (!component) continue;
            if (setting.type === 'bool') {
                ui.text('SET_' + setting.key.toUpperCase(), t(setting.label));
                continue;
            }
            if (typeof component.getStringBundle !== 'function') continue;
            const prefix = 'SID_OSA_SET_' + setting.key.toUpperCase();
            const strings = { [prefix]: t(setting.label) };
            if (setting.type === 'choice' && setting.key !== 'language') {
                setting.options.forEach(([, label], index) => { strings[prefix + '_' + index] = t(label); });
            }
            component.getStringBundle().setStrings(strings)
                .catch(error => log.warn('OSA setting language: ' + error.message));
        }
    }

    apply();
    settings.onChange(key => { if (key === 'language') apply(); });
    idriveLanguage.watch(ctx, value => {
        detected = value;
        apply();
    });
    return () => language;
}

module.exports = { start };
