import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
export async function ensureDir(path) {
    await mkdir(path, { recursive: true });
}
export async function pathExists(path) {
    try {
        await stat(path);
        return true;
    }
    catch (error) {
        if (error.code === "ENOENT") {
            return false;
        }
        throw error;
    }
}
export async function readJson(path) {
    const content = await readFile(path, "utf8");
    return JSON.parse(content);
}
export async function writeJson(path, value) {
    await ensureDir(dirname(path));
    const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(tempPath, path);
}
export async function writeText(path, value) {
    await ensureDir(dirname(path));
    const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tempPath, value, "utf8");
    await rename(tempPath, path);
}
