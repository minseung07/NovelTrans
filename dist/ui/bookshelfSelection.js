export function selectedBookshelfProject(model, selectedIndex) {
    return model.recentProjects[selectedIndex] ?? null;
}
