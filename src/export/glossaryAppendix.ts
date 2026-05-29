import type { GlossaryEntry } from "../domain/glossary.js";

export type GlossaryAppendixEntry = GlossaryEntry & { target: string };

export function glossaryAppendixEntries(entries: GlossaryEntry[]): GlossaryAppendixEntry[] {
  return entries.filter(isGlossaryAppendixEntry);
}

function isGlossaryAppendixEntry(entry: GlossaryEntry): entry is GlossaryAppendixEntry {
  return Boolean(entry.target && (entry.status === "confirmed" || entry.status === "locked"));
}
