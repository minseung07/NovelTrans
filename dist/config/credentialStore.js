import { constants, existsSync, readFileSync } from "node:fs";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { hostname, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { getDefaultConfigDir } from "./configStore.js";
export function getCredentialPath(configDir = getDefaultConfigDir()) {
    return join(configDir, "credentials.json");
}
export async function saveOpenAICompatibleApiKey(apiKey, configDir = getDefaultConfigDir()) {
    const credentials = loadCredentials(configDir);
    credentials.openAICompatibleApiKey = apiKey;
    await saveCredentials(credentials, configDir);
}
export function loadOpenAICompatibleApiKey(configDir = getDefaultConfigDir()) {
    return loadCredentials(configDir).openAICompatibleApiKey;
}
export async function clearOpenAICompatibleApiKey(configDir = getDefaultConfigDir()) {
    const credentials = loadCredentials(configDir);
    delete credentials.openAICompatibleApiKey;
    await saveCredentials(credentials, configDir);
}
function loadCredentials(configDir) {
    const path = getCredentialPath(configDir);
    if (!existsSync(path)) {
        return {};
    }
    const envelope = JSON.parse(readFileSync(path, "utf8"));
    return decrypt(envelope, configDir);
}
async function saveCredentials(credentials, configDir) {
    const path = getCredentialPath(configDir);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(encrypt(credentials, configDir), null, 2)}\n`, {
        encoding: "utf8",
        mode: constants.S_IRUSR | constants.S_IWUSR
    });
    await chmod(path, constants.S_IRUSR | constants.S_IWUSR);
}
function encrypt(credentials, configDir) {
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const key = deriveKey(salt, configDir);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(credentials), "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
        version: 1,
        algorithm: "aes-256-gcm",
        salt: salt.toString("base64"),
        iv: iv.toString("base64"),
        tag: tag.toString("base64"),
        ciphertext: ciphertext.toString("base64"),
        updatedAt: new Date().toISOString()
    };
}
function decrypt(envelope, configDir) {
    if (envelope.version !== 1 || envelope.algorithm !== "aes-256-gcm") {
        throw new Error("Unsupported credential store format.");
    }
    const salt = Buffer.from(envelope.salt, "base64");
    const iv = Buffer.from(envelope.iv, "base64");
    const key = deriveKey(salt, configDir);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()]);
    return JSON.parse(plaintext.toString("utf8"));
}
function deriveKey(salt, configDir) {
    const user = userInfo().username;
    const material = `noveltrans:${user}:${hostname()}:${configDir}`;
    return scryptSync(material, salt, 32);
}
