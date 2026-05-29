import { box, padRight, renderScreen } from "../layout.js";
import { advancedSettingsOptions, buildAdvancedSettingsForm, buildSettingsSections, settingsPickerFooter, settingsFooter, settingsSubtitle, settingsTitle } from "../settingsModel.js";
export function renderSettingsScreen(config, width, mode = "basic", connectionState, selectedSectionIndex = 0, selectedItemIndex = 0, pickerItemId = null, selectedOptionIndex = 0) {
    if (mode === "advanced") {
        return renderAdvancedSettingsScreen(config, width, connectionState, selectedSectionIndex, selectedItemIndex, pickerItemId, selectedOptionIndex);
    }
    const body = buildSettingsSections(config, mode, connectionState).flatMap((section, index) => [
        ...(index > 0 ? [""] : []),
        ...box(section.title, section.lines, width)
    ]);
    return renderScreen(settingsTitle(mode), settingsSubtitle(mode), body, settingsFooter(mode), { width });
}
function renderAdvancedSettingsScreen(config, width, connectionState, selectedSectionIndex, selectedItemIndex, pickerItemId, selectedOptionIndex) {
    const sections = buildAdvancedSettingsForm(config, connectionState);
    const sectionIndex = clampIndex(selectedSectionIndex, sections.length);
    const section = sections[sectionIndex] ?? sections[0];
    const itemIndex = clampIndex(selectedItemIndex, section?.items.length ?? 0);
    const pickerItem = pickerItemId ? findItemById(sections.flatMap((item) => item.items), pickerItemId) : null;
    const body = [
        ...box("섹션", [
            sections
                .map((item, index) => (index === sectionIndex ? `[${item.title}]` : item.title))
                .join("  ")
        ], width),
        "",
        ...box(section?.title ?? "설정", (section?.items ?? []).map((item, index) => {
            const marker = index === itemIndex ? ">" : " ";
            return `${marker} ${padRight(item.label, 14)} ${item.value}`;
        }), width)
    ];
    if (pickerItem) {
        body.push("", ...box(`옵션: ${pickerItem.label}`, pickerLines(pickerItem, selectedOptionIndex), width));
    }
    return renderScreen(settingsTitle("advanced"), settingsSubtitle("advanced"), body, pickerItem ? settingsPickerFooter(pickerItem) : settingsFooter("advanced"), { width });
}
function clampIndex(index, length) {
    if (length <= 0) {
        return 0;
    }
    return Math.max(0, Math.min(length - 1, index));
}
function findItemById(items, itemId) {
    return items.find((item) => item.id === itemId) ?? null;
}
function pickerLines(item, selectedOptionIndex) {
    const options = advancedSettingsOptions(item);
    if (options.length === 0) {
        return ["이 항목은 선택 가능한 옵션이 없습니다."];
    }
    const selectedIndex = clampIndex(selectedOptionIndex, options.length);
    return options.map((option, index) => `${index === selectedIndex ? ">" : " "} ${option.label}`);
}
