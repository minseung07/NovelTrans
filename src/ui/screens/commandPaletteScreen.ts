import { filterPaletteCommands } from "../commands.js";
import { box, renderScreen } from "../layout.js";

export function renderCommandPaletteScreen(query: string, hasProject: boolean, selectedIndex = 0, width?: number): string {
  const commands = filterPaletteCommands(query, hasProject);
  const effectiveSelectedIndex = clampIndex(selectedIndex, commands.length);
  const body = [
    ...box("명령", [
      `> ${query}`,
      "",
      ...(commands.length > 0
        ? commands.map((command, index) => `${index === effectiveSelectedIndex ? ">" : " "} ${command.requiresConfirmation ? "! " : ""}${command.label}  - ${command.hint}`)
        : ["일치하는 명령이 없습니다."])
    ], width)
  ];
  return renderScreen("명령 팔레트", "어디서든 Ctrl+K 또는 :", body, "[↑/↓] 선택   [Enter] 실행   [Esc] 닫기   ! 확인 필요", { width });
}

function clampIndex(index: number, length: number): number {
  if (length <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(length - 1, index));
}
