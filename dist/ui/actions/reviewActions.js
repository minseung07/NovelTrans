import { basename } from "node:path";
import { rerunProjectQA } from "../../engine/projectWorkflow.js";
import { translateSingleEpisode } from "../../engine/singleEpisodeTranslation.js";
import { translationMarkdownPath } from "../../storage/projectPaths.js";
import { listEpisodes, loadProjectMetadata, updateQAIssue } from "../../storage/projectStore.js";
import { writeProjectLog } from "../../storage/logger.js";
import { openFile } from "./fileOpenActions.js";
export function selectedOpenIssue(model, selectedIndex) {
    const issues = model.reviewDesk.openIssues;
    return issues[selectedIndex] ?? issues[0] ?? null;
}
export async function markSelectedIssueIgnored(projectDir, model, selectedIndex) {
    const issue = selectedOpenIssue(model, selectedIndex);
    if (!issue) {
        return "선택된 검수 항목이 없습니다.";
    }
    const updated = await updateQAIssue(projectDir, issue.id, { resolved: true });
    const metadata = await loadProjectMetadata(projectDir);
    await writeProjectLog({
        projectDir,
        category: "qa",
        event: "issue_ignored",
        message: `${issue.episodeId} ${issue.type} ignored.`,
        projectId: metadata.id,
        episodeId: issue.episodeId,
        metadata: { issueId: issue.id }
    });
    return updated ? `검수 항목을 숨겼습니다: ${issue.type}` : "검수 항목을 찾지 못했습니다.";
}
export async function retrySelectedIssueEpisode(projectDir, model, selectedIndex, adapter, signal, qaOptions) {
    return (await retrySelectedIssueEpisodeResult(projectDir, model, selectedIndex, adapter, signal, qaOptions)).message;
}
export async function retrySelectedIssueEpisodeResult(projectDir, model, selectedIndex, adapter, signal, qaOptions) {
    const issue = selectedOpenIssue(model, selectedIndex);
    if (!issue) {
        return {
            episodeId: "",
            completed: 0,
            failed: 0,
            cancelled: 0,
            message: "선택된 검수 항목이 없습니다."
        };
    }
    const summary = await translateSingleEpisode({
        projectDir,
        episodeId: issue.episodeId,
        adapter,
        reason: `Review Desk: ${issue.type}`,
        signal,
        qaOptions
    });
    return {
        episodeId: issue.episodeId,
        completed: summary.completed,
        failed: summary.failed,
        cancelled: summary.cancelled,
        message: `${issue.episodeId} 재번역 완료: 완료 ${summary.completed}, 실패 ${summary.failed}, 취소 ${summary.cancelled}.`
    };
}
export async function recheckReviewDeskQA(projectDir, onProgress, qaOptions) {
    const issues = await rerunProjectQA(projectDir, onProgress, qaOptions);
    const metadata = await loadProjectMetadata(projectDir);
    await writeProjectLog({
        projectDir,
        category: "qa",
        event: "qa_rechecked",
        message: `${issues.length} QA issue(s) after recheck.`,
        projectId: metadata.id,
        metadata: { issueCount: issues.length }
    });
    return `검수 재검사 완료: ${issues.length}개 항목.`;
}
export async function translationPathForSelectedIssue(projectDir, model, selectedIndex) {
    const path = await resolveTranslationPathForSelectedIssue(projectDir, model, selectedIndex);
    return isResolutionMessage(path) ? path : `번역문 파일: ${path} (${basename(path)})`;
}
export async function openSelectedIssueTranslation(projectDir, model, selectedIndex, options = {}) {
    const path = await resolveTranslationPathForSelectedIssue(projectDir, model, selectedIndex);
    if (isResolutionMessage(path)) {
        return path;
    }
    const result = await openFile(path, options);
    const issue = selectedOpenIssue(model, selectedIndex);
    const metadata = await loadProjectMetadata(projectDir);
    await writeProjectLog({
        projectDir,
        category: "qa",
        event: result.opened ? "translation_opened" : "translation_open_skipped",
        message: result.message,
        projectId: metadata.id,
        episodeId: issue?.episodeId,
        metadata: { command: result.command, issueId: issue?.id }
    });
    return result.opened ? result.message : `${result.message}. 바로 열려면 NOVELTRANS_EDITOR 또는 EDITOR를 설정하세요.`;
}
async function resolveTranslationPathForSelectedIssue(projectDir, model, selectedIndex) {
    const issue = selectedOpenIssue(model, selectedIndex);
    if (!issue) {
        return "선택된 검수 항목이 없습니다.";
    }
    const episodes = await listEpisodes(projectDir);
    const episode = episodes.find((item) => item.id === issue.episodeId);
    if (!episode) {
        return `화를 찾을 수 없습니다: ${issue.episodeId}`;
    }
    const path = translationMarkdownPath(projectDir, episode.episodeNo);
    return path;
}
function isResolutionMessage(value) {
    return value.startsWith("선택된") || value.startsWith("화를 ");
}
