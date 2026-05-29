import type { LogEntry } from "../domain/log.js";
import type { FailureRecoveryModel, NextActionRecommendation, ProjectUiModel } from "./types.js";
import { projectPaths } from "../storage/projectPaths.js";

export function buildNextActions(model: Omit<ProjectUiModel, "nextActions" | "failureRecovery">): NextActionRecommendation[] {
  const actions: NextActionRecommendation[] = [];
  const failedCount = model.overview.counts.failed;
  const pendingCount = model.overview.counts.pending;
  const runningCount = model.overview.counts.running;
  const skippedCount = model.overview.counts.skipped;
  const qaIssueCount = model.qaIssues.filter((issue) => !issue.resolved).length;

  if (failedCount > 0) {
    actions.push({
      priority: 10,
      severity: "critical",
      commandId: "open-failure-recovery",
      message: `${failedCount}개 화가 실패했습니다. 완료된 작업은 유지한 채 복구할 수 있습니다.`,
      commandHint: "[R] 복구"
    });
  }

  if (model.glossaryPulse.conflicts > 0) {
    actions.push({
      priority: 20,
      severity: "warning",
      commandId: "glossary-conflicts",
      message: `${model.glossaryPulse.conflicts}개 용어 충돌이 있습니다. 뒤쪽 화의 표현이 흔들리기 전에 정리하세요.`,
      commandHint: "[G] 충돌 검토"
    });
  }

  if (pendingCount > 0 || runningCount > 0) {
    const remainingCount = pendingCount + runningCount;
    const eta = estimateRemainingTime(model.liveEvents, remainingCount, Math.max(1, model.overview.metadata.options.concurrency));
    actions.push({
      priority: 30,
      severity: "info",
      commandId: "continue-translation",
      message: runningCount > 0
        ? `이전 실행에서 진행 중이던 ${runningCount}개 화가 있습니다. 이어서 번역해 상태를 정리하세요.${eta ? ` 예상 남은 시간: ${eta}.` : ""}`
        : `${pendingCount}개 화가 대기 중입니다.${eta ? ` 예상 남은 시간: ${eta}.` : ""}`,
      commandHint: "[T] 이어서 번역"
    });
  }

  if (qaIssueCount > 0) {
    actions.push({
      priority: 40,
      severity: "warning",
      commandId: "open-review",
      message: `${qaIssueCount}개 검수 항목이 기다리고 있습니다.`,
      commandHint: "[R] 검수"
    });
  }

  if (pendingCount === 0 && runningCount === 0 && failedCount === 0 && skippedCount > 0) {
    actions.push({
      priority: 50,
      severity: "warning",
      commandId: "open-export",
      message: `${skippedCount}개 화를 건너뛰었습니다. 완료된 번역만 결과물에 포함됩니다.`,
      commandHint: "[E] 일부 내보내기"
    });
  }

  if (actions.length === 0) {
    actions.push({
      priority: 90,
      severity: "info",
      commandId: "open-export",
      message: "결과물을 만들 준비가 됐습니다.",
      commandHint: "[E] 결과물 만들기"
    });
  }

  return actions.sort((left, right) => left.priority - right.priority).slice(0, 4);
}

export function buildFailureRecovery(model: Omit<ProjectUiModel, "nextActions" | "failureRecovery">): FailureRecoveryModel {
  const items = model.overview.episodeStates
    .filter((state) => state.status === "failed")
    .map((state) => ({
      episodeId: state.episodeId,
      episodeNo: state.episodeNo,
      title: state.title,
      reason: state.errorMessage ?? "알 수 없는 실패",
      attempts: state.attempts,
      updatedAt: state.updatedAt
    }));
  return {
    failedCount: items.length,
    items,
    logPath: `${projectPaths(model.overview.metadata.projectDir).logsDir}/error.log`
  };
}

function estimateRemainingTime(events: LogEntry[], pendingCount: number, concurrency: number): string | null {
  const completedEvents = events
    .filter((event) => event.event === "episode_completed")
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  if (completedEvents.length < 2) {
    return null;
  }
  const first = new Date(completedEvents[0]!.timestamp).getTime();
  const last = new Date(completedEvents.at(-1)!.timestamp).getTime();
  if (!Number.isFinite(first) || !Number.isFinite(last) || last <= first) {
    return null;
  }
  const secondsPerEpisode = (last - first) / 1000 / Math.max(1, completedEvents.length - 1);
  const estimatedSeconds = Math.ceil((pendingCount * secondsPerEpisode) / concurrency);
  if (estimatedSeconds < 60) {
    return `${estimatedSeconds}s`;
  }
  const minutes = Math.ceil(estimatedSeconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
