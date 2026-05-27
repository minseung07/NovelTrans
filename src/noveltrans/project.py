"""Project file layout and manifest management."""

from __future__ import annotations

from dataclasses import asdict, fields
from pathlib import Path
from typing import Any

from .db import ProjectDB
from .models import (
    ConnectorPolicy,
    EpisodeText,
    ExportOptions,
    ParallelOptions,
    ProjectManifest,
    QualityOptions,
    Section,
    TranslationOptions,
    WorkMetadata,
)
from .utils import atomic_write_json, ensure_dir, now_iso, read_json, slugify, unique_path


class Project:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.manifest_path = root / "project.yaml"
        self.db = ProjectDB(root / "project.db")

    @property
    def source_dir(self) -> Path:
        return self.root / "source"

    @property
    def translated_dir(self) -> Path:
        return self.root / "translated"

    @property
    def glossary_dir(self) -> Path:
        return self.root / "glossary"

    @property
    def exports_dir(self) -> Path:
        return self.root / "exports"

    @property
    def logs_dir(self) -> Path:
        return self.root / "logs"

    def ensure_layout(self) -> None:
        for path in (self.source_dir, self.translated_dir, self.glossary_dir, self.exports_dir, self.logs_dir):
            ensure_dir(path)

    def load_manifest(self) -> ProjectManifest:
        data = read_json(self.manifest_path, default=None)
        if not data:
            raise FileNotFoundError(self.manifest_path)
        return manifest_from_dict(data)

    def save_manifest(self, manifest: ProjectManifest) -> None:
        manifest.updated_at = now_iso()
        atomic_write_json(self.manifest_path, manifest.to_dict())

    def save_source_episode(self, episode: EpisodeText) -> Path:
        path = self.source_path(episode.episode_no)
        payload = {
            "episode_no": episode.episode_no,
            "title": episode.title,
            "source_url": episode.source_url,
            "source_hash": episode.source_hash,
            "metadata": episode.metadata,
            "sections": [asdict(section) for section in episode.sections],
        }
        atomic_write_json(path, payload)
        return path

    def load_source_episode(self, episode_no: int) -> EpisodeText:
        data = read_json(self.source_path(episode_no), default=None)
        if not data:
            raise FileNotFoundError(self.source_path(episode_no))
        return episode_from_dict(data)

    def list_source_episodes(self) -> list[EpisodeText]:
        episodes: list[EpisodeText] = []
        for path in sorted(self.source_dir.glob("episode_*.json")):
            data = read_json(path, default=None)
            if data:
                episodes.append(episode_from_dict(data))
        return sorted(episodes, key=lambda item: item.episode_no)

    def source_path(self, episode_no: int) -> Path:
        return self.source_dir / f"episode_{episode_no:03d}.json"

    def translation_path(self, episode_no: int) -> Path:
        return self.translated_dir / f"episode_{episode_no:03d}.ko.md"

    def qa_path(self, episode_no: int) -> Path:
        return self.logs_dir / f"episode_{episode_no:03d}.qa.json"


class ProjectManager:
    def __init__(self, base_dir: Path | str = "projects") -> None:
        self.base_dir = Path(base_dir).expanduser()

    def list_projects(self) -> list[Project]:
        if not self.base_dir.exists():
            return []
        projects = [Project(path) for path in sorted(self.base_dir.iterdir()) if (path / "project.yaml").exists()]
        return projects

    def create_project(
        self,
        name: str,
        work: WorkMetadata,
        translation: TranslationOptions,
        parallel: ParallelOptions,
        quality: QualityOptions,
        export: ExportOptions,
        source_policy: ConnectorPolicy | None,
    ) -> Project:
        ensure_dir(self.base_dir)
        slug = slugify(name)
        root = unique_path(self.base_dir / slug)
        project = Project(root)
        project.ensure_layout()
        timestamp = now_iso()
        manifest = ProjectManifest(
            name=name,
            slug=root.name,
            work=work,
            translation=translation,
            parallel=parallel,
            quality=quality,
            export=export,
            created_at=timestamp,
            updated_at=timestamp,
            source_policy=source_policy,
        )
        project.save_manifest(manifest)
        work_id = project.db.upsert_work(work.title, work.author, work.source_url, work.site)
        project.db.audit("project_created", name)
        project.db.audit("work_registered", f"{work_id}:{work.title}")
        return project

    def get_project(self, slug_or_path: str) -> Project:
        path = Path(slug_or_path).expanduser()
        if not path.exists():
            path = self.base_dir / slug_or_path
        project = Project(path)
        if not project.manifest_path.exists():
            raise FileNotFoundError(project.manifest_path)
        return project


def _filter_dataclass_fields(cls: type, data: dict[str, Any]) -> dict[str, Any]:
    names = {field.name for field in fields(cls)}
    return {key: value for key, value in data.items() if key in names}


def manifest_from_dict(data: dict[str, Any]) -> ProjectManifest:
    work = WorkMetadata(**_filter_dataclass_fields(WorkMetadata, data["work"]))
    translation = TranslationOptions(**_filter_dataclass_fields(TranslationOptions, data["translation"]))
    parallel = ParallelOptions(**_filter_dataclass_fields(ParallelOptions, data["parallel"]))
    quality = QualityOptions(**_filter_dataclass_fields(QualityOptions, data["quality"]))
    export = ExportOptions(**_filter_dataclass_fields(ExportOptions, data["export"]))
    source_policy = None
    if data.get("source_policy"):
        source_policy = ConnectorPolicy(**_filter_dataclass_fields(ConnectorPolicy, data["source_policy"]))
    return ProjectManifest(
        name=data["name"],
        slug=data["slug"],
        work=work,
        translation=translation,
        parallel=parallel,
        quality=quality,
        export=export,
        created_at=data["created_at"],
        updated_at=data["updated_at"],
        source_policy=source_policy,
    )


def episode_from_dict(data: dict[str, Any]) -> EpisodeText:
    return EpisodeText(
        episode_no=int(data["episode_no"]),
        title=str(data["title"]),
        sections=[Section(type=section["type"], text=section["text"]) for section in data.get("sections", [])],
        source_url=str(data.get("source_url", "")),
        source_hash=str(data.get("source_hash", "")),
        metadata=dict(data.get("metadata", {})),
    )
