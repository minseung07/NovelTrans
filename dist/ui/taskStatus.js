import { nowIso } from "../utils/time.js";
let taskCounter = 0;
export function createRunningTask(title, detail) {
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
export function completeTask(task, detail) {
    return {
        ...task,
        status: "completed",
        detail,
        updatedAt: nowIso()
    };
}
export function failTask(task, error) {
    return {
        ...task,
        status: "failed",
        detail: error instanceof Error ? error.message : String(error),
        updatedAt: nowIso()
    };
}
export function isTaskRunning(task) {
    return task?.status === "running";
}
export function taskStatusLines(task) {
    return [
        `상태 ${taskStatusLabel(task.status)}`,
        task.title,
        task.detail
    ];
}
function taskStatusLabel(status) {
    if (status === "running") {
        return "진행 중";
    }
    if (status === "completed") {
        return "완료";
    }
    return "실패";
}
