const KILO_TOKENS = 1_000;

const trimTrailingZeros = (value: string): string =>
    value.replace(/\.0+$|(?<=\.[0-9]*[1-9])0+$/u, '');

export const formatTokensInK = (tokens: number): string => {
    if (!Number.isFinite(tokens) || tokens <= 0) {
        return '0k';
    }

    const kiloValue = tokens / KILO_TOKENS;

    if (kiloValue >= 1000) {
        return `${Math.round(kiloValue / 1000)}M`;
    }

    if (kiloValue >= 100) {
        return `${Math.round(kiloValue)}k`;
    }

    if (kiloValue >= 10) {
        return `${trimTrailingZeros(kiloValue.toFixed(1))}k`;
    }

    return `${trimTrailingZeros(kiloValue.toFixed(2))}k`;
};
