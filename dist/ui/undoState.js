export function createUndoAction(input) {
    return {
        label: input.label,
        space: input.state.space,
        projectDir: input.state.projectDir ?? null,
        hintVisible: true,
        run: input.run
    };
}
export function scopedUndoAction(undo, state) {
    if (!undo) {
        return null;
    }
    return undo.space === state.space && undo.projectDir === (state.projectDir ?? null) ? undo : null;
}
export function visibleUndoHint(undo, state) {
    const scoped = scopedUndoAction(undo, state);
    return scoped?.hintVisible ? scoped : null;
}
export function hideUndoHint(undo) {
    return undo ? { ...undo, hintVisible: false } : null;
}
