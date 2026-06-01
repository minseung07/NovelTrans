import type { Episode } from "../domain/episode.js";
import type { NovelTransConfig } from "../domain/config.js";
import type { GlossaryData, GlossaryEntry } from "../domain/glossary.js";
import type { QAIssue, QAIssueSection } from "../domain/qa.js";
import type { TranslationResult } from "../domain/translation.js";
import { shortHash } from "../utils/hash.js";
import { nowIso } from "../utils/time.js";
import { extractNumbers, hasJapanese, paragraphs } from "../utils/text.js";

type QAOptions = NovelTransConfig["qa"];

const defaultQAOptions: QAOptions = {
  japaneseRemaining: true,
  numberMismatch: true,
  lengthRatio: true,
  glossary: true
};

type QASegment = {
  section: QAIssueSection;
  sourceText: string;
  targetText: string;
  sourceParagraphs: string[];
  targetParagraphs: string[];
};

export function runQA(episode: Episode, result: TranslationResult, glossary: GlossaryData, options: QAOptions = defaultQAOptions): QAIssue[] {
  const issues: QAIssue[] = [];
  const add = (issue: Omit<QAIssue, "id" | "episodeId" | "resolved" | "createdAt">): void => {
    const fingerprint = issue.fingerprint ?? qaIssueFingerprint({ ...issue, episodeId: episode.id });
    issues.push({
      id: `qa_${fingerprint}`,
      episodeId: episode.id,
      fingerprint,
      resolved: false,
      createdAt: nowIso(),
      ...issue
    });
  };

  const segments = buildQASegments(episode, result);
  for (const segment of segments) {
    applySegmentChecks(segment, options, add);
  }

  if (options.glossary) {
    for (const segment of segments) {
      const relevantEntries = glossary.entries.filter((entry) => entry.source && entry.status !== "deprecated" && segment.sourceText.includes(entry.source));
      for (const entry of relevantEntries) {
        applyGlossaryChecks(segment, entry, add);
      }
    }
  }

  return issues;
}

export function qaIssueFingerprint(issue: Pick<QAIssue, "episodeId" | "type"> & Partial<QAIssue>): string {
  return shortHash(
    [
      issue.episodeId,
      issue.type,
      issue.section ?? "",
      issue.sourceParagraphIndex ?? "",
      issue.targetParagraphIndex ?? "",
      normalizeFingerprintText(issue.sourceSnippet),
      normalizeFingerprintText(issue.targetSnippet),
      issue.relatedGlossaryEntryId ?? ""
    ].join("\u001f"),
    20
  );
}

function buildQASegments(episode: Episode, result: TranslationResult): QASegment[] {
  const segments = [
    ...(episode.foreword?.trim() || result.forewordKo?.trim()
      ? [{ section: "foreword" as const, sourceText: episode.foreword ?? "", targetText: result.forewordKo ?? "" }]
      : []),
    { section: "body" as const, sourceText: episode.body, targetText: result.bodyKo },
    ...(episode.afterword?.trim() || result.afterwordKo?.trim()
      ? [{ section: "afterword" as const, sourceText: episode.afterword ?? "", targetText: result.afterwordKo ?? "" }]
      : [])
  ];
  return segments.map((segment) => ({
    ...segment,
    sourceParagraphs: paragraphs(segment.sourceText),
    targetParagraphs: paragraphs(segment.targetText)
  }));
}

function applySegmentChecks(
  segment: QASegment,
  options: QAOptions,
  add: (issue: Omit<QAIssue, "id" | "episodeId" | "resolved" | "createdAt">) => void
): void {
  if (!segment.targetText.trim() && (segment.section === "body" || segment.sourceText.trim())) {
    add({
      type: "empty_translation",
      severity: "error",
      section: segment.section,
      message: `Translation ${segment.section} is empty.`
    });
  }

  const japaneseParagraph = firstParagraph(segment.targetParagraphs, hasJapanese);
  if (options.japaneseRemaining && japaneseParagraph) {
    add({
      type: "japanese_remaining",
      severity: "warning",
      section: segment.section,
      message: `Japanese characters remain in the translation ${segment.section}.`,
      targetParagraphIndex: japaneseParagraph.index,
      targetSnippet: snippet(japaneseParagraph.text)
    });
  }

  const sourceParagraphCount = segment.sourceParagraphs.length;
  const targetParagraphCount = segment.targetParagraphs.length;
  if (sourceParagraphCount > 1 && targetParagraphCount < Math.ceil(sourceParagraphCount * 0.5)) {
    add({
      type: "missing_paragraph",
      severity: "warning",
      section: segment.section,
      message: `Paragraph count looks low in ${segment.section}: source=${sourceParagraphCount}, target=${targetParagraphCount}.`,
      sourceParagraphIndex: Math.max(1, targetParagraphCount + 1)
    });
  }

  const sourceNumbers = new Set(extractNumbers(segment.sourceText));
  const targetNumbers = new Set(extractNumbers(segment.targetText));
  const missingNumbers = Array.from(sourceNumbers).filter((number) => !targetNumbers.has(number));
  if (options.numberMismatch && missingNumbers.length > 0) {
    const numberParagraph = firstParagraph(segment.sourceParagraphs, (paragraph) => missingNumbers.some((number) => extractNumbers(paragraph).includes(number)));
    add({
      type: "number_mismatch",
      severity: "warning",
      section: segment.section,
      message: `Numbers missing or changed in ${segment.section}: ${missingNumbers.join(", ")}.`,
      sourceParagraphIndex: numberParagraph?.index,
      sourceSnippet: numberParagraph ? snippet(numberParagraph.text) : undefined
    });
  }

  const ratio = segment.targetText.length / Math.max(1, segment.sourceText.length);
  if (options.lengthRatio && (ratio < 0.08 || ratio > 4.5)) {
    add({
      type: "length_ratio",
      severity: "info",
      section: segment.section,
      message: `Length ratio is unusual in ${segment.section}: ${ratio.toFixed(2)}.`
    });
  }
}

function applyGlossaryChecks(
  segment: QASegment,
  entry: GlossaryEntry,
  add: (issue: Omit<QAIssue, "id" | "episodeId" | "resolved" | "createdAt">) => void
): void {
  if (!entry.source) {
    return;
  }
  const sourceParagraph = firstParagraph(segment.sourceParagraphs, (paragraph) => paragraph.includes(entry.source));
  if (!sourceParagraph) {
    return;
  }
  if (entry.target && entry.locked && !segment.targetText.includes(entry.target)) {
    add({
      type: "locked_term_violation",
      severity: "error",
      section: segment.section,
      message: `Locked term "${entry.source}" should use "${entry.target}" in ${segment.section}.`,
      sourceParagraphIndex: sourceParagraph?.index,
      sourceSnippet: entry.source,
      relatedGlossaryEntryId: entry.id
    });
  }

  if (entry.target && entry.status === "confirmed" && !segment.targetText.includes(entry.target)) {
    add({
      type: "glossary_mismatch",
      severity: "warning",
      section: segment.section,
      message: `Confirmed term "${entry.source}" may not use "${entry.target}" in ${segment.section}.`,
      sourceParagraphIndex: sourceParagraph?.index,
      sourceSnippet: entry.source,
      relatedGlossaryEntryId: entry.id
    });
  }

  for (const forbidden of entry.forbiddenTargets) {
    if (forbidden && segment.targetText.includes(forbidden)) {
      const targetParagraph = firstParagraph(segment.targetParagraphs, (paragraph) => paragraph.includes(forbidden));
      add({
        type: "forbidden_term",
        severity: "error",
        section: segment.section,
        message: `Forbidden target "${forbidden}" appears for "${entry.source}" in ${segment.section}.`,
        targetParagraphIndex: targetParagraph?.index,
        targetSnippet: forbidden,
        relatedGlossaryEntryId: entry.id
      });
    }
  }

  const variantTargets = translationVariantsFor(entry, segment.targetText);
  if (entry.target && variantTargets.some((target) => target !== entry.target)) {
    const targetParagraph = firstParagraph(segment.targetParagraphs, (paragraph) => variantTargets.some((target) => paragraph.includes(target)));
    add({
      type: "name_inconsistency",
      severity: "warning",
      section: segment.section,
      message: `Multiple target names appear for "${entry.source}" in ${segment.section}: ${variantTargets.join(", ")}.`,
      sourceParagraphIndex: sourceParagraph?.index,
      targetParagraphIndex: targetParagraph?.index,
      sourceSnippet: entry.source,
      targetSnippet: variantTargets.join(" / "),
      relatedGlossaryEntryId: entry.id
    });
    return;
  }

  if (!entry.target && variantTargets.length > 1) {
    const targetParagraph = firstParagraph(segment.targetParagraphs, (paragraph) => variantTargets.some((target) => paragraph.includes(target)));
    add({
      type: "name_inconsistency",
      severity: "warning",
      section: segment.section,
      message: `Multiple target candidates appear for "${entry.source}" in ${segment.section}: ${variantTargets.join(", ")}.`,
      sourceParagraphIndex: sourceParagraph?.index,
      targetParagraphIndex: targetParagraph?.index,
      sourceSnippet: entry.source,
      targetSnippet: variantTargets.join(" / "),
      relatedGlossaryEntryId: entry.id
    });
  }
}

function snippet(value: string): string {
  return value.trim().slice(0, 120);
}

function normalizeFingerprintText(value: string | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ");
}

function firstParagraph(paragraphs: string[], predicate: (paragraph: string) => boolean): { index: number; text: string } | null {
  const index = paragraphs.findIndex(predicate);
  if (index < 0) {
    return null;
  }
  return { index: index + 1, text: paragraphs[index] ?? "" };
}

function translationVariantsFor(entry: GlossaryEntry, bodyKo: string): string[] {
  if (!entry.source || entry.targetCandidates.length === 0) {
    return [];
  }
  const candidates = new Set(entry.targetCandidates.map((candidate) => candidate.target).filter(Boolean));
  if (entry.target) {
    candidates.add(entry.target);
  }
  return Array.from(candidates)
    .filter((target) => bodyKo.includes(target))
    .sort();
}
