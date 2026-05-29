import type { BookshelfModel, BookshelfProject } from "./types.js";

export function selectedBookshelfProject(model: BookshelfModel, selectedIndex: number): BookshelfProject | null {
  return model.recentProjects[selectedIndex] ?? null;
}
