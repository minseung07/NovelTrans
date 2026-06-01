import type { Episode } from "../domain/episode.js";
import type { GlossaryConflict, GlossaryData, GlossaryEntry, GlossaryTargetCandidate, GlossaryTermType } from "../domain/glossary.js";
import { shortHash } from "../utils/hash.js";
import { nowIso } from "../utils/time.js";

type CandidateAccumulator = {
  source: string;
  count: number;
  episodeNos: Set<number>;
  episodeIds: Set<string>;
  quoted: boolean;
};

const quotedTermPattern = /[「『“"]([^」』”"]{2,24})[」』”"]/gu;
const japaneseTermPattern = /[\p{Script=Katakana}\p{Script=Han}々ー]{2,18}/gu;

export function createEmptyGlossary(): GlossaryData {
  return {
    version: 1,
    entries: [],
    conflicts: [],
    updatedAt: nowIso()
  };
}

export function extractGlossaryCandidates(episodes: Episode[], existing: GlossaryData = createEmptyGlossary()): GlossaryData {
  const candidates = collectCandidates(episodes);
  const bySource = new Map(existing.entries.map((entry) => [entry.source, entry]));
  const now = nowIso();

  for (const candidate of candidates.values()) {
    if (candidate.count < 2 && !candidate.quoted) {
      continue;
    }
    const episodeNos = Array.from(candidate.episodeNos).sort((left, right) => left - right);
    const existingEntry = bySource.get(candidate.source);
    if (existingEntry) {
      existingEntry.occurrenceCount = candidate.count;
      existingEntry.firstSeenEpisode = episodeNos[0] ?? null;
      existingEntry.lastSeenEpisode = episodeNos.at(-1) ?? null;
      existingEntry.sourceScore = scoreCandidate(candidate);
      existingEntry.confidence = Math.max(existingEntry.confidence, existingEntry.sourceScore);
      existingEntry.updatedAt = now;
      continue;
    }
    bySource.set(candidate.source, {
      id: `glossary_${shortHash(candidate.source)}`,
      source: candidate.source,
      target: null,
      type: classifyTerm(candidate.source),
      status: "candidate",
      aliases: [],
      forbiddenTargets: [],
      notes: "",
      confidence: scoreCandidate(candidate),
      sourceScore: scoreCandidate(candidate),
      targetScore: 0,
      occurrenceCount: candidate.count,
      firstSeenEpisode: episodeNos[0] ?? null,
      lastSeenEpisode: episodeNos.at(-1) ?? null,
      locked: false,
      targetCandidates: [],
      createdAt: now,
      updatedAt: now
    });
  }

  const entries = Array.from(bySource.values()).sort((left, right) => {
    const scoreDelta = right.confidence - left.confidence;
    return scoreDelta === 0 ? left.source.localeCompare(right.source) : scoreDelta;
  });
  const data = {
    version: 1 as const,
    entries,
    conflicts: detectGlossaryConflicts(entries),
    updatedAt: now
  };
  return data;
}

export function confirmGlossaryTerm(data: GlossaryData, source: string, target: string, lock = false): GlossaryData {
  const now = nowIso();
  const entries = [...data.entries];
  const entry = entries.find((candidate) => candidate.source === source);

  if (entry) {
    entry.target = target;
    entry.status = lock ? "locked" : "confirmed";
    entry.locked = lock;
    entry.targetScore = Math.max(entry.targetScore, 1);
    entry.targetCandidates = confirmedTargetCandidates(entry, target);
    entry.updatedAt = now;
  } else {
    entries.push({
      id: `glossary_${shortHash(source)}`,
      source,
      target,
      type: classifyTerm(source),
      status: lock ? "locked" : "confirmed",
      aliases: [],
      forbiddenTargets: [],
      notes: "",
      confidence: 1,
      sourceScore: 1,
      targetScore: 1,
      occurrenceCount: 0,
      firstSeenEpisode: null,
      lastSeenEpisode: null,
      locked: lock,
      targetCandidates: [{ target, count: 1, episodeIds: ["manual"] }],
      createdAt: now,
      updatedAt: now
    });
  }

  return {
    ...data,
    entries,
    conflicts: detectGlossaryConflicts(entries),
    updatedAt: now
  };
}

export function addForbiddenTarget(data: GlossaryData, source: string, forbiddenTarget: string): GlossaryData {
  const now = nowIso();
  const entries = [...data.entries];
  let entry = entries.find((candidate) => candidate.source === source);
  if (!entry) {
    entry = {
      id: `glossary_${shortHash(source)}`,
      source,
      target: null,
      type: classifyTerm(source),
      status: "forbidden",
      aliases: [],
      forbiddenTargets: [],
      notes: "",
      confidence: 0.5,
      sourceScore: 0.5,
      targetScore: 0,
      occurrenceCount: 0,
      firstSeenEpisode: null,
      lastSeenEpisode: null,
      locked: false,
      targetCandidates: [],
      createdAt: now,
      updatedAt: now
    };
    entries.push(entry);
  }
  if (entry) {
    entry.status = entry.target ? entry.status : "forbidden";
    entry.forbiddenTargets = Array.from(new Set([...entry.forbiddenTargets, forbiddenTarget]));
    entry.updatedAt = now;
  }
  return {
    ...data,
    entries,
    conflicts: detectGlossaryConflicts(entries),
    updatedAt: now
  };
}

export function deprecateGlossaryTerm(data: GlossaryData, source: string): GlossaryData {
  const now = nowIso();
  const entries = [...data.entries];
  const entry = entries.find((candidate) => candidate.source === source);
  if (!entry) {
    return data;
  }
  entry.status = "deprecated";
  entry.locked = false;
  entry.updatedAt = now;
  return {
    ...data,
    entries,
    conflicts: detectGlossaryConflicts(entries),
    updatedAt: now
  };
}

export function addTargetCandidate(data: GlossaryData, source: string, target: string, episodeId: string): GlossaryData {
  const now = nowIso();
  const entries = [...data.entries];
  let entry = entries.find((candidate) => candidate.source === source);
  if (!entry) {
    entry = {
      id: `glossary_${shortHash(source)}`,
      source,
      target: null,
      type: classifyTerm(source),
      status: "candidate",
      aliases: [],
      forbiddenTargets: [],
      notes: "",
      confidence: 0.5,
      sourceScore: 0.5,
      targetScore: 0.5,
      occurrenceCount: 0,
      firstSeenEpisode: null,
      lastSeenEpisode: null,
      locked: false,
      targetCandidates: [],
      createdAt: now,
      updatedAt: now
    };
    entries.push(entry);
  }
  entry.targetCandidates = mergeTargetCandidate(entry.targetCandidates, target, episodeId);
  entry.updatedAt = now;
  return {
    ...data,
    entries,
    conflicts: detectGlossaryConflicts(entries),
    updatedAt: now
  };
}

export function mergeTranslationGlossaryCandidates(data: GlossaryData, candidates: string[], episodeId: string): GlossaryData {
  let next = data;
  for (const candidate of candidates) {
    const parsed = parseTranslationGlossaryCandidate(candidate);
    if (!parsed) {
      continue;
    }
    next = addTargetCandidate(next, parsed.source, parsed.target, episodeId);
  }
  return next;
}

export function detectGlossaryConflicts(entries: GlossaryEntry[]): GlossaryConflict[] {
  const grouped = new Map<string, GlossaryEntry[]>();
  for (const entry of entries) {
    if (entry.status === "deprecated") {
      continue;
    }
    const items = grouped.get(entry.source) ?? [];
    items.push(entry);
    grouped.set(entry.source, items);
  }

  const conflicts: GlossaryConflict[] = [];
  const now = nowIso();
  for (const [source, sourceEntries] of grouped) {
    const targets = new Set<string>();
    for (const entry of sourceEntries) {
      if (entry.target) {
        targets.add(entry.target);
      }
      for (const candidate of entry.targetCandidates) {
        targets.add(candidate.target);
      }
    }
    if (targets.size > 1) {
      conflicts.push({
        id: `conflict_${shortHash(`${source}:${Array.from(targets).sort().join("|")}`)}`,
        source,
        targets: Array.from(targets).sort(),
        entryIds: sourceEntries.map((entry) => entry.id),
        status: "open",
        message: `${source} has multiple target candidates.`,
        updatedAt: now
      });
    }
  }
  return conflicts.sort((left, right) => left.source.localeCompare(right.source));
}

function confirmedTargetCandidates(entry: GlossaryEntry, target: string): GlossaryTargetCandidate[] {
  const existing = entry.targetCandidates.find((candidate) => candidate.target === target);
  return [
    {
      target,
      count: Math.max(1, (existing?.count ?? 0) + 1),
      episodeIds: Array.from(new Set([...(existing?.episodeIds ?? []), "manual"]))
    }
  ];
}

export function buildGlossaryContext(entries: GlossaryEntry[], strictness: "low" | "medium" | "high" | "strict", sourceText = ""): string {
  const usableEntries = entries.filter((entry) => entry.target && (entry.status === "confirmed" || entry.status === "locked"));
  if (usableEntries.length === 0) {
    return "";
  }
  const limit = strictness === "low" ? 20 : strictness === "medium" ? 50 : 100;
  const selectedEntries = sourceText.trim() ? prioritizedGlossaryEntries(usableEntries, sourceText).slice(0, limit) : usableEntries.slice(0, limit);
  return selectedEntries
    .map((entry) => {
      const lockHint = entry.locked || strictness === "strict" ? "locked" : entry.status;
      return `- ${entry.source} => ${entry.target} (${lockHint})`;
    })
    .join("\n");
}

function prioritizedGlossaryEntries(entries: GlossaryEntry[], sourceText: string): GlossaryEntry[] {
  return entries
    .map((entry, index) => ({ entry, index, relevance: glossarySourceRelevance(entry, sourceText) }))
    .sort((left, right) => {
      if (right.relevance !== left.relevance) {
        return right.relevance - left.relevance;
      }
      if (Number(right.entry.locked) !== Number(left.entry.locked)) {
        return Number(right.entry.locked) - Number(left.entry.locked);
      }
      if (statusRank(right.entry) !== statusRank(left.entry)) {
        return statusRank(right.entry) - statusRank(left.entry);
      }
      if (right.entry.occurrenceCount !== left.entry.occurrenceCount) {
        return right.entry.occurrenceCount - left.entry.occurrenceCount;
      }
      if (right.entry.confidence !== left.entry.confidence) {
        return right.entry.confidence - left.entry.confidence;
      }
      return left.index - right.index;
    })
    .map((item) => item.entry);
}

function glossarySourceRelevance(entry: GlossaryEntry, sourceText: string): number {
  if (entry.source && sourceText.includes(entry.source)) {
    return 2;
  }
  return entry.aliases.some((alias) => alias && sourceText.includes(alias)) ? 1 : 0;
}

function statusRank(entry: GlossaryEntry): number {
  return entry.status === "locked" ? 2 : entry.status === "confirmed" ? 1 : 0;
}

function collectCandidates(episodes: Episode[]): Map<string, CandidateAccumulator> {
  const candidates = new Map<string, CandidateAccumulator>();
  for (const episode of episodes) {
    for (const match of episode.sourceText.matchAll(quotedTermPattern)) {
      const source = cleanTerm(match[1] ?? "");
      if (source) {
        bumpCandidate(candidates, source, episode, true);
      }
    }
    for (const match of episode.sourceText.matchAll(japaneseTermPattern)) {
      const source = cleanTerm(match[0] ?? "");
      if (source) {
        bumpCandidate(candidates, source, episode, false);
      }
    }
  }
  return candidates;
}

function bumpCandidate(candidates: Map<string, CandidateAccumulator>, source: string, episode: Episode, quoted: boolean): void {
  const existing = candidates.get(source) ?? {
    source,
    count: 0,
    episodeNos: new Set<number>(),
    episodeIds: new Set<string>(),
    quoted: false
  };
  existing.count += 1;
  existing.episodeNos.add(episode.episodeNo);
  existing.episodeIds.add(episode.id);
  existing.quoted = existing.quoted || quoted;
  candidates.set(source, existing);
}

function cleanTerm(source: string): string {
  const trimmed = source.trim().replace(/\s+/g, "");
  if (trimmed.length < 2 || trimmed.length > 24) {
    return "";
  }
  if (/^[々ー]+$/u.test(trimmed)) {
    return "";
  }
  return trimmed;
}

function scoreCandidate(candidate: CandidateAccumulator): number {
  const frequencyScore = Math.min(0.45, candidate.count * 0.08);
  const spreadScore = Math.min(0.35, candidate.episodeNos.size * 0.12);
  const quotedScore = candidate.quoted ? 0.2 : 0;
  return Number((0.2 + frequencyScore + spreadScore + quotedScore).toFixed(3));
}

function classifyTerm(source: string): GlossaryTermType {
  if (/[王姫君帝爵]/u.test(source)) {
    return "title";
  }
  if (/[国都城村森山川]/u.test(source)) {
    return "place";
  }
  if (/[剣刀杖鎧石珠]/u.test(source)) {
    return "item";
  }
  if (/[\p{Script=Katakana}ー]{2,}/u.test(source)) {
    return "term";
  }
  return "unknown";
}

function mergeTargetCandidate(candidates: GlossaryTargetCandidate[], target: string, episodeId: string): GlossaryTargetCandidate[] {
  if (!target) {
    return candidates;
  }
  const merged = candidates.map((candidate) => ({ ...candidate, episodeIds: [...candidate.episodeIds] }));
  const existing = merged.find((candidate) => candidate.target === target);
  if (existing) {
    existing.count += 1;
    if (!existing.episodeIds.includes(episodeId)) {
      existing.episodeIds.push(episodeId);
    }
    return merged;
  }
  return [...merged, { target, count: 1, episodeIds: [episodeId] }];
}

function parseTranslationGlossaryCandidate(candidate: string): { source: string; target: string } | null {
  const match = candidate.match(/^\s*(.+?)\s*(?:=>|->|→)\s*(.+?)\s*$/u);
  if (!match?.[1] || !match[2]) {
    return null;
  }
  const source = match[1].trim();
  const target = match[2].trim();
  return source && target ? { source, target } : null;
}
