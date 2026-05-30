// Colored severity dot (●) + label. With color disabled it degrades to the
// plain label so non-color terminals stay readable.

import { getTheme, type Severity } from "../theme/theme.js";

export type { Severity };

export function severityBadge(level: Severity, label: string): string {
  const theme = getTheme();
  const colored = theme.severity(level, label);
  return theme.colorLevel > 0 ? `${theme.badge(level)} ${colored}` : colored;
}
