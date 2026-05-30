import type { WebImportSite } from "./types.js";

type DetectedWebImportUrl = {
  site: WebImportSite;
  url: URL;
};

export function detectWebImportUrl(value: string): DetectedWebImportUrl | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (host === "kakuyomu.jp" || host === "www.kakuyomu.jp") {
    return { site: "kakuyomu", url: normalizeHttps(url) };
  }
  if (host === "ncode.syosetu.com") {
    return { site: "syosetu", url: normalizeHttps(url) };
  }
  return null;
}

export function isAllowedWebImportFetchUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") {
    return false;
  }
  const host = url.hostname.toLowerCase();
  if (host === "kakuyomu.jp" || host === "www.kakuyomu.jp") {
    return true;
  }
  if (host === "ncode.syosetu.com") {
    return true;
  }
  return host === "api.syosetu.com" && url.pathname === "/novelapi/api/";
}

function normalizeHttps(url: URL): URL {
  const normalized = new URL(url.toString());
  normalized.protocol = "https:";
  return normalized;
}
