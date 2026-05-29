import type { Episode } from "../domain/episode.js";
import type { NovelTransConfig } from "../domain/config.js";
import type { GlossaryData, GlossaryEntry } from "../domain/glossary.js";
import type { QAIssue } from "../domain/qa.js";
import type { TranslationResult } from "../domain/translation.js";
import { newId } from "../utils/hash.js";
import { nowIso } from "../utils/time.js";
import { extractNumbers, hasJapanese, paragraphs } from "../utils/text.js";

export type QAOptions = NovelTransConfig["qa"];

const defaultQAOptions: QAOptions = {
  japaneseRemaining: true,
  numberMismatch: true,
  lengthRatio: true,
  glossary: true
};

export function runQA(episode: Episode, result: TranslationResult, glossary: GlossaryData, options: QAOptions = defaultQAOptions): QAIssue[] {
  const issues: QAIssue[] = [];
  const add = (issue: Omit<QAIssue, "id" | "episodeId" | "resolved" | "createdAt">): void => {
    issues.push({
      id: newId("qa"),
      episodeId: episode.id,
      resolved: false,
      createdAt: nowIso(),
      ...issue
    });
  };

  if (!result.bodyKo.trim()) {
    add({
      type: "empty_translation",
      severity: "error",
      message: "Translation body is empty."
    });
  }

  const sourceParagraphs = paragraphs(episode.body);
  const targetParagraphs = paragraphs(result.bodyKo);
  const japaneseParagraph = firstParagraph(targetParagraphs, hasJapanese);
  if (options.japaneseRemaining && japaneseParagraph) {
    add({
      type: "japanese_remaining",
      severity: "warning",
      message: "Japanese characters remain in the translation body.",
      targetParagraphIndex: japaneseParagraph.index,
      targetSnippet: snippet(japaneseParagraph.text)
    });
  }

  const sourceParagraphCount = sourceParagraphs.length;
  const targetParagraphCount = targetParagraphs.length;
  if (sourceParagraphCount > 1 && targetParagraphCount < Math.ceil(sourceParagraphCount * 0.5)) {
    add({
      type: "missing_paragraph",
      severity: "warning",
      message: `Paragraph count looks low: source=${sourceParagraphCount}, target=${targetParagraphCount}.`,
      sourceParagraphIndex: Math.max(1, targetParagraphCount + 1)
    });
  }

  const sourceNumbers = new Set(extractNumbers(episode.body));
  const targetNumbers = new Set(extractNumbers(result.bodyKo));
  const missingNumbers = Array.from(sourceNumbers).filter((number) => !targetNumbers.has(number));
  if (options.numberMismatch && missingNumbers.length > 0) {
    const numberParagraph = firstParagraph(sourceParagraphs, (paragraph) => missingNumbers.some((number) => extractNumbers(paragraph).includes(number)));
    add({
      type: "number_mismatch",
      severity: "warning",
      message: `Numbers missing or changed: ${missingNumbers.join(", ")}.`,
      sourceParagraphIndex: numberParagraph?.index,
      sourceSnippet: numberParagraph ? snippet(numberParagraph.text) : undefined
    });
  }

  const ratio = result.bodyKo.length / Math.max(1, episode.body.length);
  if (options.lengthRatio && (ratio < 0.08 || ratio > 4.5)) {
    add({
      type: "length_ratio",
      severity: "info",
      message: `Length ratio is unusual: ${ratio.toFixed(2)}.`
    });
  }

  if (options.glossary) {
    for (const entry of glossary.entries) {
      applyGlossaryChecks(episode, result, entry, sourceParagraphs, targetParagraphs, add);
    }
  }

  return issues;
}

function applyGlossaryChecks(
  episode: Episode,
  result: TranslationResult,
  entry: GlossaryEntry,
  sourceParagraphs: string[],
  targetParagraphs: string[],
  add: (issue: Omit<QAIssue, "id" | "episodeId" | "resolved" | "createdAt">) => void
): void {
  if (entry.status === "deprecated" || !entry.source) {
    return;
  }
  const sourceParagraph = firstParagraph(sourceParagraphs, (paragraph) => paragraph.includes(entry.source));
  if (!sourceParagraph) {
    return;
  }
  if (entry.target && entry.locked && !result.bodyKo.includes(entry.target)) {
    add({
      type: "locked_term_violation",
      severity: "error",
      message: `Locked term "${entry.source}" should use "${entry.target}".`,
      sourceParagraphIndex: sourceParagraph?.index,
      sourceSnippet: entry.source,
      relatedGlossaryEntryId: entry.id
    });
  }

  if (entry.target && entry.status === "confirmed" && !result.bodyKo.includes(entry.target)) {
    add({
      type: "glossary_mismatch",
      severity: "warning",
      message: `Confirmed term "${entry.source}" may not use "${entry.target}".`,
      sourceParagraphIndex: sourceParagraph?.index,
      sourceSnippet: entry.source,
      relatedGlossaryEntryId: entry.id
    });
  }

  for (const forbidden of entry.forbiddenTargets) {
    if (forbidden && result.bodyKo.includes(forbidden)) {
      const targetParagraph = firstParagraph(targetParagraphs, (paragraph) => paragraph.includes(forbidden));
      add({
        type: "forbidden_term",
        severity: "error",
        message: `Forbidden target "${forbidden}" appears for "${entry.source}".`,
        targetParagraphIndex: targetParagraph?.index,
        targetSnippet: forbidden,
        relatedGlossaryEntryId: entry.id
      });
    }
  }

  const variantTargets = translationVariantsFor(entry, result.bodyKo);
  if (entry.target && variantTargets.some((target) => target !== entry.target)) {
    const targetParagraph = firstParagraph(targetParagraphs, (paragraph) => variantTargets.some((target) => paragraph.includes(target)));
    add({
      type: "name_inconsistency",
      severity: "warning",
      message: `Multiple target names appear for "${entry.source}": ${variantTargets.join(", ")}.`,
      sourceParagraphIndex: sourceParagraph?.index,
      targetParagraphIndex: targetParagraph?.index,
      sourceSnippet: entry.source,
      targetSnippet: variantTargets.join(" / "),
      relatedGlossaryEntryId: entry.id
    });
    return;
  }

  if (!entry.target && variantTargets.length > 1) {
    const targetParagraph = firstParagraph(targetParagraphs, (paragraph) => variantTargets.some((target) => paragraph.includes(target)));
    add({
      type: "name_inconsistency",
      severity: "warning",
      message: `Multiple target candidates appear for "${entry.source}": ${variantTargets.join(", ")}.`,
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
