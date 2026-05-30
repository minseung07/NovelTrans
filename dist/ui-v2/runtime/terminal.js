// Terminal control: raw mode, alternate screen, cursor hide/restore, bracketed
// paste, and resize (SIGWINCH via the tty 'resize' event). Listeners are kept in
// arrays so the runtime can subscribe without owning the stream lifecycle.
import { stdin as defaultInput, stdout as defaultOutput } from "node:process";
function sizeOf(output) {
    return { cols: output.columns ?? 80, rows: output.rows ?? 24 };
}
export function createTerminal(input = defaultInput, output = defaultOutput) {
    const dataCbs = [];
    const resizeCbs = [];
    const isInteractive = Boolean(input.isTTY && output.isTTY);
    const handleData = (chunk) => {
        const value = String(chunk);
        for (const cb of dataCbs) {
            cb(value);
        }
    };
    const handleResize = () => {
        const size = sizeOf(output);
        for (const cb of resizeCbs) {
            cb(size);
        }
    };
    return {
        isInteractive,
        size: () => sizeOf(output),
        write: (data) => {
            output.write(data);
        },
        onData: (cb) => {
            dataCbs.push(cb);
        },
        onResize: (cb) => {
            resizeCbs.push(cb);
        },
        start() {
            if (!isInteractive) {
                return;
            }
            input.setRawMode(true);
            input.resume();
            input.setEncoding("utf8");
            output.write("\x1b[?1049h\x1b[?2004h\x1b[?25l");
            input.on("data", handleData);
            output.on("resize", handleResize);
        },
        stop() {
            if (!isInteractive) {
                return;
            }
            input.off("data", handleData);
            output.off("resize", handleResize);
            output.write("\x1b[?2004l\x1b[?25h\x1b[?1049l");
            input.setRawMode(false);
            input.pause();
        }
    };
}
