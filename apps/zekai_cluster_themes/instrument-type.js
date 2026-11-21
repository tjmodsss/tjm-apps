'use strict';

const FONTS = {
    regular: 'instrument_regular',
    medium: 'instrument_medium',
    bold: 'instrument_bold',
};
const TEXT_SIZE_RATIO = 0.9;

function instrumentType(canvas, x, y, scale, ink, sizeRatio = 1) {
    const textScale = scale * TEXT_SIZE_RATIO * sizeRatio;
    const measure = (value, size, weight = 'regular', hanFallback = false) => canvas.textWidth(value, size * textScale, {
        literal: true, font: FONTS[weight], hanFallback,
    }) / scale;
    return {
        text(value, cx, cy, size, colour = ink, weight = 'regular', spacing = 0, hanFallback = false) {
            return canvas.text(value, x(cx), y(cy), size * textScale, colour, {
                align: 'center', literal: true, font: FONTS[weight], spacing: spacing * textScale, hanFallback,
            });
        },
        measure,
        fitBold(value, size, maxWidth) {
            const width = measure(value, size, 'bold');
            const limit = maxWidth * sizeRatio;
            return width > limit ? size * limit / width : size;
        },
    };
}

module.exports = { instrumentType, FONTS, TEXT_SIZE_RATIO };
