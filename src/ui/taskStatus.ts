import { nowIso } from "../utils/time.js";

export type UiTaskStatus = "running" | "completed" | "failed";

export type UiTaskSnapshot = {
  id: string;
  title: string;
  status: UiTaskStatus;
  detail: string;
  startedAt: string;
  updatedAt: string;
};

let taskCounter = 0;

export function createRunningTask(title: string, detail: string): UiTaskSnapshot {
  const timestamp = nowIso();
  taskCounter += 1;
  return {
    id: `ui_task_${taskCounter}`,
    title,
    status: "running",
    detail,
    startedAt: timestamp,
    updatedAt: timestamp
  };
}

export function completeTask(task: UiTaskSnapshot, detail: string): UiTaskSnapshot {
  return {
    ...task,
    status: "completed",
    detail,
    updatedAt: nowIso()
  };
}

export function failTask(task: UiTaskSnapshot, error: unknown): UiTaskSnapshot {
  return {
    ...task,
    status: "failed",
    detail: error instanceof Error ? error.message : String(error),
    updatedAt: nowIso()
  };
}

export function isTaskRunning(task: UiTaskSnapshot | null): boolean {
  return task?.status === "running";
}

export function taskStatusLines(task: UiTaskSnapshot): string[] {
  return [
    `상태 ${taskStatusLabel(task.status)}`,
    task.title,
    task.detail
  ];
}

function taskStatusLabel(status: UiTaskStatus): string {
  if (status === "running") {
    return "진행 중";
  }
  if (status === "completed") {
    return "완료";
  }
  return "실패";
}
