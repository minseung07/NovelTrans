export function withSuppressedExperimentalSqliteWarning(run) {
    const originalEmitWarning = process.emitWarning;
    process.emitWarning = ((warning, ...args) => {
        if (isExperimentalSqliteWarning(warning, args)) {
            return;
        }
        return originalEmitWarning(warning, ...args);
    });
    try {
        return run();
    }
    finally {
        process.emitWarning = originalEmitWarning;
    }
}
function isExperimentalSqliteWarning(warning, args) {
    const message = typeof warning === "string" ? warning : warning.message;
    const warningName = typeof warning === "string" ? null : warning.name;
    const type = typeof args[0] === "string" ? args[0] : null;
    return message.includes("SQLite") && (type === "ExperimentalWarning" || warningName === "ExperimentalWarning");
}
