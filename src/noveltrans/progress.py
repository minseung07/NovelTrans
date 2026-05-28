"""Progress snapshots for visible translation runs."""

from __future__ import annotations

from dataclasses import dataclass
from time import monotonic
from typing import Callable

from .project import Project


@dataclass(frozen=True, slots=True)
class WorkflowEvent:
    stage: str
    message: str
    current: int = 0
    total: int = 0
    episode_no: int | None = None


ProgressCallback = Callable[[WorkflowEvent], None]


@dataclass(frozen=True, slots=True)
class ProgressSnapshot:
    total: int
    pending: list[int]
    running: list[int]
    completed: list[int]
    failed: list[int]
    elapsed_seconds: float = 0.0

    @property
    def done(self) -> int:
        return len(self.completed) + len(self.failed)


def target_episode_numbers(project: Project, resume: bool = True) -> list[int]:
    episodes = project.list_source_episodes()
    if not resume:
        return sorted(episode.episode_no for episode in episodes)
    statuses = project.db.episode_statuses()
    numbers = [
        episode.episode_no
        for episode in episodes
        if not (
            statuses.get(episode.episode_no) == "completed"
            and project.translation_path(episode.episode_no).exists()
        )
    ]
    return sorted(numbers)


def snapshot_project_progress(
    project: Project,
    target_numbers: list[int] | None = None,
    started_at: float | None = None,
) -> ProgressSnapshot:
    if target_numbers is None:
        numbers = sorted(item.episode_no for item in project.list_source_episodes())
    else:
        numbers = sorted(target_numbers)
    statuses = project.db.episode_statuses()
    pending: list[int] = []
    running: list[int] = []
    completed: list[int] = []
    failed: list[int] = []
    for number in numbers:
        status = statuses.get(number, "pending")
        if status == "completed" and project.translation_path(number).exists():
            completed.append(number)
        elif status == "running":
            running.append(number)
        elif status == "failed":
            failed.append(number)
        else:
            pending.append(number)
    elapsed = monotonic() - started_at if started_at is not None else 0.0
    return ProgressSnapshot(
        total=len(numbers),
        pending=pending,
        running=running,
        completed=completed,
        failed=failed,
        elapsed_seconds=max(0.0, elapsed),
    )


def format_progress_lines(snapshot: ProgressSnapshot, backend: str = "") -> list[str]:
    elapsed = int(snapshot.elapsed_seconds)
    minutes, seconds = divmod(elapsed, 60)
    lines = [
        f"진행: {snapshot.done}/{snapshot.total} 완료",
        f"대기: {_format_numbers(snapshot.pending)}",
        f"진행 중: {_format_numbers(snapshot.running)}",
        f"완료: {_format_numbers(snapshot.completed)}",
        f"실패: {_format_numbers(snapshot.failed)}",
        f"경과: {minutes:02d}:{seconds:02d}",
    ]
    if backend:
        lines.insert(1, f"백엔드: {backend}")
    return lines


def format_progress_line(snapshot: ProgressSnapshot, backend: str = "") -> str:
    parts = [
        f"{snapshot.done}/{snapshot.total}",
        f"대기 {_format_numbers(snapshot.pending)}",
        f"진행 {_format_numbers(snapshot.running)}",
        f"완료 {_format_numbers(snapshot.completed)}",
        f"실패 {_format_numbers(snapshot.failed)}",
    ]
    if backend:
        parts.insert(1, backend)
    return " | ".join(parts)


def _format_numbers(numbers: list[int]) -> str:
    if not numbers:
        return "없음"
    ranges: list[str] = []
    start = previous = numbers[0]
    for number in numbers[1:]:
        if number == previous + 1:
            previous = number
            continue
        ranges.append(str(start) if start == previous else f"{start}-{previous}")
        start = previous = number
    ranges.append(str(start) if start == previous else f"{start}-{previous}")
    return ", ".join(ranges)
