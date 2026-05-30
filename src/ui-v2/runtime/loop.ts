// MVU runtime with effects. update returns [model, Effect[]]; the program's
// runEffect performs the side effect and dispatches result messages. Effects
// may return a cleanup (e.g. cancel a job / clear a poll timer) which runs on
// quit. A lone trailing ESC is held briefly (escTimeoutMs) so a split arrow
// sequence is not misread.

import { createDiffRenderer } from "./renderer.js";
import { decodeChunk, type KeyEvent } from "./input.js";
import { createTerminal, type Terminal, type TerminalSize } from "./terminal.js";

export type Dispatch<Msg> = (msg: Msg) => void;

export interface KeyContext<Msg> {
  dispatch: Dispatch<Msg>;
  quit: () => void;
}

interface Program<Model, Msg, Effect> {
  init: Model;
  initEffects?: Effect[];
  update(model: Model, msg: Msg): [Model, Effect[]];
  view(model: Model, size: TerminalSize): string;
  onKey(model: Model, event: KeyEvent, ctx: KeyContext<Msg>): void;
  runEffect(effect: Effect, dispatch: Dispatch<Msg>): void | (() => void);
}

interface RunOptions {
  terminal?: Terminal;
  escTimeoutMs?: number;
}

export function runProgram<Model, Msg, Effect>(program: Program<Model, Msg, Effect>, options: RunOptions = {}): Promise<void> {
  const terminal = options.terminal ?? createTerminal();
  const escTimeoutMs = options.escTimeoutMs ?? 40;
  const renderer = createDiffRenderer({ write: (data) => terminal.write(data) });
  let model = program.init;
  let running = true;
  let pending = "";
  let escTimer: NodeJS.Timeout | null = null;
  const cleanups = new Set<() => void>();

  const render = () => {
    renderer.render(program.view(model, terminal.size()));
  };

  return new Promise<void>((resolve, reject) => {
    const clearEscTimer = () => {
      if (escTimer) {
        clearTimeout(escTimer);
        escTimer = null;
      }
    };
    const runEffects = (effects: Effect[]) => {
      for (const effect of effects) {
        const cleanup = program.runEffect(effect, dispatch);
        if (cleanup) {
          cleanups.add(cleanup);
        }
      }
    };
    const dispatch: Dispatch<Msg> = (msg) => {
      if (!running) {
        return;
      }
      const [next, effects] = program.update(model, msg);
      model = next;
      render();
      runEffects(effects);
    };
    let stopped = false;
    const teardown = () => {
      if (stopped) {
        return;
      }
      stopped = true;
      running = false;
      clearEscTimer();
      for (const cleanup of cleanups) {
        cleanup();
      }
      cleanups.clear();
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
      process.off("uncaughtException", onFatal);
      process.off("unhandledRejection", onFatal);
      terminal.stop();
    };
    const quit = () => {
      if (stopped) {
        return;
      }
      teardown();
      resolve();
    };
    const onSignal = () => quit();
    const onFatal = (error: unknown) => {
      teardown();
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    const guard = (fn: () => void) => {
      try {
        fn();
      } catch (error) {
        onFatal(error);
      }
    };
    const emit = (events: KeyEvent[]) => {
      for (const event of events) {
        if (!running) {
          break;
        }
        program.onKey(model, event, { dispatch, quit });
      }
    };

    terminal.onData((chunk) => {
      if (!running) {
        return;
      }
      guard(() => {
        clearEscTimer();
        const result = decodeChunk(pending, chunk);
        pending = result.pending;
        emit(result.events);
        if (running && pending) {
          escTimer = setTimeout(() => {
            escTimer = null;
            pending = "";
            guard(() => emit([{ type: "key", name: "escape" }]));
          }, escTimeoutMs);
        }
      });
    });
    terminal.onResize(() => {
      if (!running) {
        return;
      }
      guard(() => {
        renderer.invalidate();
        render();
      });
    });

    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);
    process.on("uncaughtException", onFatal);
    process.on("unhandledRejection", onFatal);

    guard(() => {
      terminal.start();
      render();
      runEffects(program.initEffects ?? []);
    });
    if (running && !terminal.isInteractive) {
      quit();
    }
  });
}
