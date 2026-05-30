// Terminal capability detection. Zero dependencies.
// Color level: 0 = none, 1 = 16 colors, 2 = 256 colors, 3 = truecolor.
export function detectColorLevel(stream, env = process.env) {
    const force = env.FORCE_COLOR;
    if (force !== undefined) {
        if (force === "0" || force === "false") {
            return 0;
        }
        if (force === "2") {
            return 2;
        }
        if (force === "3") {
            return 3;
        }
        return 1;
    }
    if (env.NO_COLOR !== undefined) {
        return 0;
    }
    if (!stream?.isTTY) {
        return 0;
    }
    const term = env.TERM ?? "";
    if (term === "dumb") {
        return 0;
    }
    if (/truecolor|24bit/i.test(env.COLORTERM ?? "")) {
        return 3;
    }
    if (/-256(color)?$/i.test(term)) {
        return 2;
    }
    return 1;
}
export function detectUnicode(stream, env = process.env) {
    if (!stream?.isTTY) {
        return false;
    }
    if ((env.TERM ?? "") === "dumb") {
        return false;
    }
    if (env.NOVELTRANS_ASCII !== undefined) {
        return false;
    }
    const locale = env.LC_ALL ?? env.LC_CTYPE ?? env.LANG ?? "";
    if (locale && !/utf-?8/i.test(locale)) {
        return false;
    }
    return true;
}
