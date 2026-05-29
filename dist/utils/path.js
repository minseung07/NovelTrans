export function slugify(value) {
    const normalized = value
        .normalize("NFKD")
        .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
        .replace(/^-+|-+$/g, "")
        .toLowerCase();
    return normalized || "novel";
}
export function padEpisodeNo(value) {
    return String(value).padStart(3, "0");
}
