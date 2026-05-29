import { createHash, randomUUID } from "node:crypto";
export function hashText(value) {
    return createHash("sha256").update(value).digest("hex");
}
export function shortHash(value, length = 12) {
    return hashText(value).slice(0, length);
}
export function newId(prefix) {
    return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
}
