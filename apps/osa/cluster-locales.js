'use strict';

const warmupLabels = {
    sk: 'Olej zohriaty',
    cs: 'Olej zahřátý',
    da: 'Olien er varm',
    de: 'Motoröl warm',
    el: 'Το λάδι ζεστάθηκε',
    en: 'Oil warmed up',
    es: 'Aceite caliente',
    fr: 'Huile à température',
    it: 'Olio in temperatura',
    'zh-CN': '油温已达标',
    hu: 'Az olaj bemelegedett',
    nl: 'Olie op temperatuur',
    nb: 'Oljen er varm',
    pl: 'Olej rozgrzany',
    pt: 'Óleo à temperatura',
    ro: 'Ulei încălzit',
    ru: 'Масло прогрето',
    sl: 'Olje ogreto',
    fi: 'Öljy on lämmennyt',
    sv: 'Oljan är varm',
    tr: 'Yağ ısındı',
    uk: 'Олива прогріта',
};

function warmupLabel(language) {
    return Object.prototype.hasOwnProperty.call(warmupLabels, language)
        ? warmupLabels[language]
        : warmupLabels.en;
}

module.exports = { warmupLabel };
