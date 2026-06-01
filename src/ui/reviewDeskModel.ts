import type { QAIssue, QAIssueType } from "../domain/qa.js";
import type { Episode } from "../domain/episode.js";
import type { ReviewDeskModel, ReviewEpisodeGroup, ReviewIssueBucketId, ReviewIssueFilter } from "./types.js";

const bucketRules: Array<{ id: Exclude<ReviewIssueBucketId, "other">; label: string; matches: QAIssueType[] }> = [
  { id: "missing", label: "누락 의심", matches: ["missing_paragraph", "empty_translation"] },
  { id: "japanese", label: "일본어 잔존", matches: ["japanese_remaining"] },
  { id: "names", label: "이름 불일치", matches: ["name_inconsistency"] },
  { id: "terms", label: "용어 문제", matches: ["glossary_mismatch", "locked_term_violation", "forbidden_term"] },
  { id: "numbers", label: "숫자 불일치", matches: ["number_mismatch"] },
  { id: "length", label: "길이 비율", matches: ["length_ratio"] }
];

export const reviewIssueFilterOrder: ReviewIssueFilter[] = ["all", ...bucketRules.map((rule) => rule.id), "other"];

export function buildReviewDeskModel(issues: QAIssue[], episodes: Episode[] = []): ReviewDeskModel {
  const openIssues = issues.filter((issue) => !issue.resolved);
  const bucketedTypes = new Set(bucketRules.flatMap((rule) => rule.matches));
  const buckets: ReviewDeskModel["buckets"] = bucketRules.map((rule) => ({
    id: rule.id,
    label: rule.label,
    count: openIssues.filter((issue) => rule.matches.includes(issue.type)).length
  }));
  buckets.push({
    id: "other",
    label: "기타",
    count: openIssues.filter((issue) => !bucketedTypes.has(issue.type)).length
  });
  return { openIssues, buckets, episodeGroups: buildEpisodeGroups(openIssues, episodes) };
}

export function reviewFilterLabel(filter: ReviewIssueFilter): string {
  if (filter === "all") {
    return "전체";
  }
  return bucketRules.find((rule) => rule.id === filter)?.label ?? "기타";
}

export function filterReviewIssues(issues: QAIssue[], filter: ReviewIssueFilter): QAIssue[] {
  return issues.filter((issue) => reviewIssueMatchesFilter(issue, filter));
}

export function filterReviewEpisodeGroups(reviewDesk: ReviewDeskModel, filter: ReviewIssueFilter): ReviewEpisodeGroup[] {
  return reviewDesk.episodeGroups
    .map((group) => ({ ...group, issues: filterReviewIssues(group.issues, filter) }))
    .filter((group) => group.issues.length > 0);
}

export function selectedReviewIssue(reviewDesk: ReviewDeskModel, selectedIndex: number, filter: ReviewIssueFilter = "all"): QAIssue | null {
  const group = filterReviewEpisodeGroups(reviewDesk, filter)[selectedIndex];
  return group?.issues[0] ?? filterReviewIssues(reviewDesk.openIssues, filter)[selectedIndex] ?? null;
}

function reviewIssueMatchesFilter(issue: QAIssue, filter: ReviewIssueFilter): boolean {
  if (filter === "all") {
    return true;
  }
  const rule = bucketRules.find((candidate) => candidate.id === filter);
  if (!rule) {
    return !bucketRules.some((candidate) => candidate.matches.includes(issue.type));
  }
  return rule.matches.includes(issue.type);
}

function buildEpisodeGroups(issues: QAIssue[], episodes: Episode[]): ReviewEpisodeGroup[] {
  const episodesById = new Map(episodes.map((episode) => [episode.id, episode]));
  const groups = new Map<string, ReviewEpisodeGroup>();
  for (const issue of issues) {
    const episode = episodesById.get(issue.episodeId);
    const group =
      groups.get(issue.episodeId) ??
      {
        episodeId: issue.episodeId,
        episodeNo: episode?.episodeNo ?? null,
        title: episode?.title ?? issue.episodeId,
        issues: []
      };
    group.issues.push(issue);
    groups.set(issue.episodeId, group);
  }
  return Array.from(groups.values()).sort((left, right) => {
    if (left.episodeNo !== null && right.episodeNo !== null && left.episodeNo !== right.episodeNo) {
      return left.episodeNo - right.episodeNo;
    }
    if (left.episodeNo !== null && right.episodeNo === null) {
      return -1;
    }
    if (left.episodeNo === null && right.episodeNo !== null) {
      return 1;
    }
    return left.episodeId.localeCompare(right.episodeId);
  });
}
