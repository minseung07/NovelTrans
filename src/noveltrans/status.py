"""Shared project status formatting helpers."""

from __future__ import annotations

from dataclasses import dataclass

from .project import Project


@dataclass(frozen=True, slots=True)
class ProjectStatus:
    completed: list[int]
    failed: list[int]
    pending: list[int]

    @property
    def counts(self) -> dict[str, int]:
        return {
            "completed": len(self.completed),
            "failed": len(self.failed),
            "pending": len(self.pending),
        }


def project_status(project: Project) -> ProjectStatus:
    db_statuses = project.db.episode_statuses()
    source_numbers = [episode.episode_no for episode in project.list_source_episodes()]
    completed: list[int] = []
    failed: list[int] = []
    pending: list[int] = []
    for number in source_numbers:
        status = db_statuses.get(number, "pending")
        if status == "completed" and project.translation_path(number).exists():
            completed.append(number)
        elif status == "failed":
            failed.append(number)
        else:
            pending.append(number)
    return ProjectStatus(completed=completed, failed=failed, pending=pending)


def format_episode_numbers(numbers: list[int] | tuple[int, ...]) -> str:
    values = sorted(int(number) for number in numbers)
    if not values:
        return "없음"
    ranges: list[str] = []
    start = previous = values[0]
    for number in values[1:]:
        if number == previous + 1:
            previous = number
            continue
        ranges.append(format_episode_range(start, previous))
        start = previous = number
    ranges.append(format_episode_range(start, previous))
    return ", ".join(ranges)


def format_episode_range(start: int, end: int) -> str:
    return str(start) if start == end else f"{start}-{end}"


def project_status_lines(project: Project) -> list[str]:
    status = project_status(project)
    return [
        f"상태: {status.counts}",
        f"- 완료: {format_episode_numbers(status.completed)}",
        f"- 실패: {format_episode_numbers(status.failed)}",
        f"- 미번역: {format_episode_numbers(status.pending)}",
    ]


def project_status_text(project: Project) -> str:
    status = project_status(project)
    return "\n".join(
        [
            f"완료: {format_episode_numbers(status.completed)}",
            f"실패: {format_episode_numbers(status.failed)}",
            f"미번역: {format_episode_numbers(status.pending)}",
        ]
    )
