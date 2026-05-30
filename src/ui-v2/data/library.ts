// Library data: reuses the existing bookshelf loader and adds the instant
// filter used by the Library search (which absorbs the old separate search
// screen).

import type { BookshelfProject } from "../../ui/types.js";

export { loadBookshelfModel } from "../../ui/studioData.js";

export function filterProjects(projects: BookshelfProject[], query: string): BookshelfProject[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return projects;
  }
  return projects.filter((project) =>
    `${project.title} ${project.statusText} ${project.shelfStatusLabel} ${project.projectDir}`.toLowerCase().includes(normalized)
  );
}
