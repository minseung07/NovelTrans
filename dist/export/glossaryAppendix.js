export function glossaryAppendixEntries(entries) {
    return entries.filter(isGlossaryAppendixEntry);
}
function isGlossaryAppendixEntry(entry) {
    return Boolean(entry.target && (entry.status === "confirmed" || entry.status === "locked"));
}
