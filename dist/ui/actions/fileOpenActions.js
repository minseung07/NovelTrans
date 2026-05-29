import { spawn } from "node:child_process";
import { platform } from "node:os";
export async function openFile(path, options = {}) {
    const command = options.editorCommand ?? process.env.NOVELTRANS_EDITOR ?? process.env.VISUAL ?? process.env.EDITOR ?? defaultOpenCommand();
    if (!command) {
        return {
            opened: false,
            command: null,
            message: `열기 명령이 설정되지 않았습니다: ${path}`
        };
    }
    const [executable, ...baseArgs] = splitCommand(command);
    if (!executable) {
        return {
            opened: false,
            command: null,
            message: `열기 명령이 올바르지 않습니다: ${path}`
        };
    }
    const args = [...baseArgs, path];
    try {
        if (options.wait) {
            await runAndWait(executable, args);
        }
        else {
            const error = await spawnDetached(executable, args);
            if (error) {
                return {
                    opened: false,
                    command: [executable, ...args].join(" "),
                    message: `열지 못했습니다: ${path} (${error.message})`
                };
            }
        }
    }
    catch (error) {
        return {
            opened: false,
            command: [executable, ...args].join(" "),
            message: `열지 못했습니다: ${path} (${error.message})`
        };
    }
    return {
        opened: true,
        command: [executable, ...args].join(" "),
        message: `열었습니다: ${path}`
    };
}
function defaultOpenCommand() {
    if (platform() === "darwin") {
        return "open";
    }
    if (platform() === "win32") {
        return "cmd /c start";
    }
    return "xdg-open";
}
function runAndWait(executable, args) {
    return new Promise((resolve, reject) => {
        const child = spawn(executable, args, {
            stdio: "ignore"
        });
        child.on("error", reject);
        child.on("close", (code) => {
            if (code === 0) {
                resolve();
            }
            else {
                reject(new Error(`${executable} exited with code ${code}.`));
            }
        });
    });
}
function spawnDetached(executable, args) {
    return new Promise((resolve) => {
        const child = spawn(executable, args, {
            detached: true,
            stdio: "ignore"
        });
        child.once("error", (error) => {
            resolve(error);
        });
        child.once("spawn", () => {
            child.unref();
            resolve(null);
        });
    });
}
function splitCommand(command) {
    const tokens = [];
    let current = "";
    let quote = null;
    for (const char of command.trim()) {
        if ((char === "'" || char === "\"") && !quote) {
            quote = char;
            continue;
        }
        if (char === quote) {
            quote = null;
            continue;
        }
        if (char === " " && !quote) {
            if (current) {
                tokens.push(current);
                current = "";
            }
            continue;
        }
        current += char;
    }
    if (current) {
        tokens.push(current);
    }
    return tokens;
}
