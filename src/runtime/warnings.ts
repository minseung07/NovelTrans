export function withSuppressedExperimentalSqliteWarning<T>(run: () => T): T {
  const originalEmitWarning = process.emitWarning;
  process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
    if (isExperimentalSqliteWarning(warning, args)) {
      return;
    }
    return (originalEmitWarning as (...items: unknown[]) => void)(warning, ...args);
  }) as typeof process.emitWarning;
  try {
    return run();
  } finally {
    process.emitWarning = originalEmitWarning;
  }
}

function isExperimentalSqliteWarning(warning: string | Error, args: unknown[]): boolean {
  const message = typeof warning === "string" ? warning : warning.message;
  const warningName = typeof warning === "string" ? null : warning.name;
  const type = typeof args[0] === "string" ? args[0] : null;
  return message.includes("SQLite") && (type === "ExperimentalWarning" || warningName === "ExperimentalWarning");
}
