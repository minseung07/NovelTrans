import type { StudioSpace } from "./types.js";
import type { TerminalState } from "./terminalState.js";

export type UndoAction = {
  label: string;
  space: StudioSpace;
  projectDir: string | null;
  hintVisible: boolean;
  run: () => Promise<string>;
};

export function createUndoAction(input: {
  label: string;
  state: TerminalState;
  run: () => Promise<string>;
}): UndoAction {
  return {
    label: input.label,
    space: input.state.space,
    projectDir: input.state.projectDir ?? null,
    hintVisible: true,
    run: input.run
  };
}

export function scopedUndoAction(undo: UndoAction | null, state: TerminalState): UndoAction | null {
  if (!undo) {
    return null;
  }
  return undo.space === state.space && undo.projectDir === (state.projectDir ?? null) ? undo : null;
}

export function visibleUndoHint(undo: UndoAction | null, state: TerminalState): UndoAction | null {
  const scoped = scopedUndoAction(undo, state);
  return scoped?.hintVisible ? scoped : null;
}

export function hideUndoHint(undo: UndoAction | null): UndoAction | null {
  return undo ? { ...undo, hintVisible: false } : null;
}
