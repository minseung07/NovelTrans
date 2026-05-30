import type { QAIssue, QAIssueType } from "../domain/qa.js";
import type { ReviewDeskModel } from "./types.js";

const bucketRules: Array<{ id: string; label: string; matches: QAIssueType[] }> = [
  { id: "missing", label: "누락 의심", matches: ["missing_paragraph", "empty_translation"] },
  { id: "japanese", label: "일본어 잔존", matches: ["japanese_remaining"] },
  { id: "names", label: "이름 불일치", matches: ["name_inconsistency"] },
  { id: "terms", label: "용어 문제", matches: ["glossary_mismatch", "locked_term_violation", "forbidden_term"] },
  { id: "numbers", label: "숫자 불일치", matches: ["number_mismatch"] },
  { id: "length", label: "길이 비율", matches: ["length_ratio"] }
];

export function buildReviewDeskModel(issues: QAIssue[]): ReviewDeskModel {
  const openIssues = issues.filter((issue) => !issue.resolved);
  const bucketedTypes = new Set(bucketRules.flatMap((rule) => rule.matches));
  const buckets = bucketRules.map((rule) => ({
    id: rule.id,
    label: rule.label,
    count: openIssues.filter((issue) => rule.matches.includes(issue.type)).length
  }));
  buckets.push({
    id: "other",
    label: "기타",
    count: openIssues.filter((issue) => !bucketedTypes.has(issue.type)).length
  });
  return { openIssues, buckets };
}
