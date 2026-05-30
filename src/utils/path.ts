export function slugify(value: string): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return normalized || "novel";
}

export function padEpisodeNo(value: number): string {
  return String(value).padStart(5, "0");
}

export function legacyPadEpisodeNo(value: number): string {
  return String(value).padStart(3, "0");
}
