import { join } from "node:path";
import { pathExists } from "../storage/jsonFile.js";
import { projectPaths } from "../storage/projectPaths.js";
import { slugify } from "../utils/path.js";
export async function buildBookshelfProject(overview) {
    const paths = projectPaths(overview.metadata.projectDir);
    const slug = slugify(overview.metadata.name);
    const [txtExists, epubExists] = await Promise.all([
        pathExists(join(paths.exportsDir, `${slug}.txt`)),
        pathExists(join(paths.exportsDir, `${slug}.epub`))
    ]);
    const completed = overview.counts.completed;
    const total = overview.episodeStates.length;
    const failed = overview.counts.failed;
    const running = overview.counts.running;
    const skipped = overview.counts.skipped;
    const qaIssues = overview.qaIssueCount;
    const conflicts = overview.glossaryConflictCount;
    return {
        projectDir: overview.metadata.projectDir,
        title: overview.metadata.name,
        completed,
        total,
        failed,
        running,
        skipped,
        qaIssues,
        candidates: overview.glossaryCandidateCount,
        conflicts,
        txtExists,
        epubExists,
        shelfStatusLabel: shelfStatusLabel({ completed, total, failed, running, skipped, qaIssues, conflicts, txtExists, epubExists }),
        nextActionLabel: nextActionLabel({ completed, total, failed, running, skipped, qaIssues, conflicts, txtExists, epubExists }),
        statusText: overview.metadata.status,
        updatedAt: overview.metadata.updatedAt
    };
}
function shelfStatusLabel(state) {
    if (state.failed > 0) {
        return `재시도 필요 ${state.failed}개`;
    }
    if (state.running > 0) {
        return `진행 중 ${state.running}개`;
    }
    if (state.qaIssues > 0) {
        return `검수 필요 ${state.qaIssues}개`;
    }
    if (state.conflicts > 0) {
        return `용어 충돌 ${state.conflicts}개`;
    }
    if (state.skipped > 0) {
        return `일부 제외 ${state.skipped}개`;
    }
    if (state.epubExists) {
        return "EPUB 생성됨";
    }
    if (state.txtExists) {
        return "TXT 생성됨";
    }
    if (state.total > 0 && state.completed === state.total) {
        return "결과물 준비";
    }
    if (state.completed > 0) {
        return "번역 이어가기";
    }
    return "준비됨";
}
function nextActionLabel(state) {
    if (state.failed > 0) {
        return "[R] 복구";
    }
    if (state.running > 0) {
        return "[T] 상태 정리";
    }
    if (state.qaIssues > 0) {
        return "[R] 검수";
    }
    if (state.conflicts > 0) {
        return "[G] 용어";
    }
    if (state.skipped > 0) {
        return "[E] 일부 결과물";
    }
    if (state.total > 0 && state.completed === state.total && !state.epubExists) {
        return "[E] 결과물";
    }
    return "[Enter] 계속";
}
