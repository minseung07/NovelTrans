export function extractMetaContent(html: string, key: string): string | null {
  const escapedKey = escapeRegExp(key);
  const patterns = [
    new RegExp(`<meta\\b[^>]*(?:property|name)=["']${escapedKey}["'][^>]*content=["']([^"']*)["'][^>]*>`, "i"),
    new RegExp(`<meta\\b[^>]*content=["']([^"']*)["'][^>]*(?:property|name)=["']${escapedKey}["'][^>]*>`, "i")
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return decodeHtml(match[1].trim());
    }
  }
  return null;
}

export function extractTitle(html: string): string | null {
  const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return match?.[1] ? normalizeText(stripTags(match[1])) : null;
}

export function extractElementById(html: string, id: string): string | null {
  const pattern = new RegExp(`<([a-z0-9]+)\\b[^>]*id=["']${escapeRegExp(id)}["'][^>]*>([\\s\\S]*?)<\\/\\1>`, "i");
  return html.match(pattern)?.[2] ?? null;
}

export function extractElementByClass(html: string, className: string): string | null {
  const pattern = new RegExp(`<([a-z0-9]+)\\b[^>]*class=["'][^"']*\\b${escapeRegExp(className)}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/\\1>`, "i");
  return html.match(pattern)?.[2] ?? null;
}

export function extractAnchorLinks(html: string): Array<{ href: string; text: string }> {
  const links: Array<{ href: string; text: string }> = [];
  const pattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html))) {
    const attrs = match[1] ?? "";
    const href = attrs.match(/\bhref=["']([^"']+)["']/i)?.[1];
    if (!href) {
      continue;
    }
    links.push({ href: decodeHtml(href), text: normalizeText(stripTags(match[2] ?? "")) });
  }
  return links;
}

export function htmlToText(html: string): string {
  return decodeHtml(
    html
      .replace(/<script\b[\s\S]*?<\/script>/gi, "")
      .replace(/<style\b[\s\S]*?<\/style>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p\s*>/gi, "\n")
      .replace(/<\/div\s*>/gi, "\n")
      .replace(/<\/section\s*>/gi, "\n")
      .replace(/<[^>]+>/g, "")
  )
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function stripTags(value: string): string {
  return decodeHtml(value.replace(/<[^>]+>/g, ""));
}

export function normalizeText(value: string): string {
  return decodeHtml(value).replace(/\s+/g, " ").trim();
}

export function decodeHtml(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " "
  };
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi, (entity, body: string) => {
    const normalized = body.toLowerCase();
    if (normalized.startsWith("#x")) {
      return fromCodePoint(Number.parseInt(normalized.slice(2), 16), entity);
    }
    if (normalized.startsWith("#")) {
      return fromCodePoint(Number.parseInt(normalized.slice(1), 10), entity);
    }
    return named[normalized] ?? entity;
  });
}

export function absoluteUrl(base: string, href: string): string {
  return new URL(href, base).toString();
}

function fromCodePoint(value: number, fallback: string): string {
  return Number.isFinite(value) ? String.fromCodePoint(value) : fallback;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
