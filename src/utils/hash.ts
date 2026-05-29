import { createHash, randomUUID } from "node:crypto";

export function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function shortHash(value: string, length = 12): string {
  return hashText(value).slice(0, length);
}

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
}
