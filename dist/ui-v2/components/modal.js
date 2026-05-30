// Modal overlay: a prominent, width-capped box for input/confirm prompts.
import { box } from "./box.js";
export function modal(title, lines, width) {
    return box(title, lines, Math.min(width, 60));
}
