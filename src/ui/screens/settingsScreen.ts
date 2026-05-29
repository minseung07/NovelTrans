import type { NovelTransConfig } from "../../domain/config.js";
import type { AdvancedSettingsItem, AdvancedSettingsItemId, SettingsViewMode } from "../types.js";
import { box, padRight, renderScreen } from "../layout.js";
import {
  advancedSettingsOptions,
  buildAdvancedSettingsForm,
  buildSettingsSections,
  settingsPickerFooter,
  settingsFooter,
  settingsSubtitle,
  settingsTitle,
  type SettingsConnectionState
} from "../settingsModel.js";

export function renderSettingsScreen(
  config: NovelTransConfig,
  width?: number,
  mode: SettingsViewMode = "basic",
  connectionState?: SettingsConnectionState,
  selectedSectionIndex = 0,
  selectedItemIndex = 0,
  pickerItemId: AdvancedSettingsItemId | null = null,
  selectedOptionIndex = 0
): string {
  if (mode === "advanced") {
    return renderAdvancedSettingsScreen(config, width, connectionState, selectedSectionIndex, selectedItemIndex, pickerItemId, selectedOptionIndex);
  }
  const body = buildSettingsSections(config, mode, connectionState).flatMap((section, index) => [
    ...(index > 0 ? [""] : []),
    ...box(section.title, section.lines, width)
  ]);
  return renderScreen(settingsTitle(mode), settingsSubtitle(mode), body, settingsFooter(mode), { width });
}

function renderAdvancedSettingsScreen(
  config: NovelTransConfig,
  width: number | undefined,
  connectionState: SettingsConnectionState | undefined,
  selectedSectionIndex: number,
  selectedItemIndex: number,
  pickerItemId: AdvancedSettingsItemId | null,
  selectedOptionIndex: number
): string {
  const sections = buildAdvancedSettingsForm(config, connectionState);
  const sectionIndex = clampIndex(selectedSectionIndex, sections.length);
  const section = sections[sectionIndex] ?? sections[0];
  const itemIndex = clampIndex(selectedItemIndex, section?.items.length ?? 0);
  const pickerItem = pickerItemId ? findItemById(sections.flatMap((item) => item.items), pickerItemId) : null;
  const body = [
    ...box(
      "섹션",
      [
        sections
          .map((item, index) => (index === sectionIndex ? `[${item.title}]` : item.title))
          .join("  ")
      ],
      width
    ),
    "",
    ...box(
      section?.title ?? "설정",
      (section?.items ?? []).map((item, index) => {
        const marker = index === itemIndex ? ">" : " ";
        return `${marker} ${padRight(item.label, 14)} ${item.value}`;
      }),
      width
    )
  ];
  if (pickerItem) {
    body.push("", ...box(`옵션: ${pickerItem.label}`, pickerLines(pickerItem, selectedOptionIndex), width));
  }
  return renderScreen(
    settingsTitle("advanced"),
    settingsSubtitle("advanced"),
    body,
    pickerItem ? settingsPickerFooter(pickerItem) : settingsFooter("advanced"),
    { width }
  );
}

function clampIndex(index: number, length: number): number {
  if (length <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(length - 1, index));
}

function findItemById(items: AdvancedSettingsItem[], itemId: AdvancedSettingsItemId): AdvancedSettingsItem | null {
  return items.find((item) => item.id === itemId) ?? null;
}

function pickerLines(item: AdvancedSettingsItem, selectedOptionIndex: number): string[] {
  const options = advancedSettingsOptions(item);
  if (options.length === 0) {
    return ["이 항목은 선택 가능한 옵션이 없습니다."];
  }
  const selectedIndex = clampIndex(selectedOptionIndex, options.length);
  return options.map((option, index) => `${index === selectedIndex ? ">" : " "} ${option.label}`);
}
