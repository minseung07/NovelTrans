export type QAIssueType =
  | "empty_translation"
  | "missing_paragraph"
  | "japanese_remaining"
  | "number_mismatch"
  | "length_ratio"
  | "glossary_mismatch"
  | "locked_term_violation"
  | "forbidden_term"
  | "name_inconsistency"
  | "repetition"
  | "other";

export type QAIssue = {
  id: string;
  episodeId: string;
  type: QAIssueType;
  severity: "info" | "warning" | "error";
  message: string;
  sourceParagraphIndex?: number;
  targetParagraphIndex?: number;
  sourceSnippet?: string;
  targetSnippet?: string;
  relatedGlossaryEntryId?: string;
  resolved: boolean;
  createdAt: string;
};
