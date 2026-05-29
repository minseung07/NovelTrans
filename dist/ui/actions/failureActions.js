import { exportProject } from "../../export/exporter.js";
import { loadProjectMetadata, saveProjectMetadata } from "../../storage/projectStore.js";
import { projectPaths } from "../../storage/projectPaths.js";
import { ProjectStateStore } from "../../storage/stateStore.js";
import { writeProjectLog } from "../../storage/logger.js";
import { nowIso } from "../../utils/time.js";
export async function skipFailedEpisodes(projectDir) {
    const metadata = await loadProjectMetadata(projectDir);
    const stateStore = new ProjectStateStore(projectPaths(projectDir).projectDb);
    let skipped = 0;
    let episodeIds = [];
    try {
        const failedStates = stateStore.listEpisodeStates().filter((state) => state.status === "failed");
        episodeIds = failedStates.map((state) => state.episodeId);
        for (const state of failedStates) {
            stateStore.setEpisodeStatus(state.episodeId, "skipped", "Skipped from Failure Recovery.");
        }
        skipped = failedStates.length;
        if (skipped > 0) {
            const nextStates = stateStore.listEpisodeStates();
            metadata.status = nextStates.every((state) => state.status === "completed" || state.status === "skipped")
                ? "completed_with_issues"
                : "ready";
            metadata.updatedAt = nowIso();
            await saveProjectMetadata(metadata);
        }
    }
    finally {
        stateStore.close();
    }
    if (skipped > 0) {
        await writeProjectLog({
            projectDir,
            category: "translation",
            level: "warn",
            event: "failed_episodes_skipped",
            message: `${skipped} failed episode(s) skipped for export.`,
            projectId: metadata.id,
            metadata: { episodeIds }
        });
    }
    return skipped;
}
export async function skipFailedAndExport(projectDir) {
    const skipped = await skipFailedEpisodes(projectDir);
    const metadata = await loadProjectMetadata(projectDir);
    const summary = await exportProject(metadata, metadata.outputOptions.formats);
    return `실패 화 ${skipped}개를 제외하고 ${summary.files.length}개 파일을 생성했습니다: ${summary.files.join(", ")}`;
}
export function errorLogPath(projectDir) {
    return `${projectPaths(projectDir).logsDir}/error.log`;
}
