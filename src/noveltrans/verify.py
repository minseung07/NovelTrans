"""Project output verification."""

from __future__ import annotations

import zipfile
from dataclasses import dataclass, field
from pathlib import Path

from .exporters import normalize_export_formats
from .project import Project
from .utils import read_json


@dataclass(slots=True)
class VerificationReport:
    ok: bool
    issues: list[str] = field(default_factory=list)
    checked: list[str] = field(default_factory=list)


def verify_project(project: Project, formats: list[str] | None = None) -> VerificationReport:
    issues: list[str] = []
    checked: list[str] = []
    manifest = project.load_manifest()
    _verify_manifest(manifest, issues)
    requested_formats = normalize_export_formats(formats or manifest.export.formats)
    source_episodes = project.list_source_episodes()
    checked.append(f"source_episodes={len(source_episodes)}")
    if not source_episodes:
        issues.append("source/no_episodes")

    statuses = project.db.episode_statuses()
    source_numbers = {episode.episode_no for episode in source_episodes}
    db_numbers = set(statuses)
    for number in sorted(db_numbers - source_numbers):
        issues.append(f"db/orphan_episode:{number}")
    for path in sorted(project.translated_dir.glob("episode_*.ko.md")):
        episode_no = _episode_number_from_translation_path(path)
        if episode_no is None:
            issues.append(f"translation/unrecognized_file:{path.name}")
        elif episode_no not in source_numbers:
            issues.append(f"translation/orphan_file:{episode_no}")
    for episode in source_episodes:
        _verify_source_episode(episode.episode_no, episode.metadata, issues)
        _verify_source_hash(project, episode.episode_no, episode.source_hash, statuses, issues)
        status = statuses.get(episode.episode_no, "missing")
        if status == "completed":
            path = project.translation_path(episode.episode_no)
            if not path.exists():
                issues.append(f"translation/missing_file:{episode.episode_no}")
            elif not path.read_text(encoding="utf-8").strip():
                issues.append(f"translation/empty_file:{episode.episode_no}")
            _verify_episode_qa(project, episode.episode_no, issues)
        elif status == "failed":
            issues.append(f"translation/failed:{episode.episode_no}")
        else:
            issues.append(f"translation/incomplete:{episode.episode_no}:{status}")

    if source_episodes:
        checked.append(f"db_statuses={statuses}")
    checked.append(f"exports={','.join(requested_formats)}")
    for fmt in requested_formats:
        path = project.exports_dir / f"{manifest.slug}.{fmt}"
        if not path.exists():
            issues.append(f"export/missing:{fmt}")
            continue
        if not path.stat().st_size:
            issues.append(f"export/empty:{fmt}")
        if fmt == "epub":
            _verify_zip_members(
                path,
                [
                    "mimetype",
                    "META-INF/container.xml",
                    "OEBPS/content.opf",
                    "OEBPS/nav.xhtml",
                    "OEBPS/title.xhtml",
                    "OEBPS/style.css",
                ],
                issues,
                "epub",
            )

    if not (project.logs_dir / "quality_report.json").exists():
        issues.append("logs/missing_quality_report_json")
    else:
        _verify_quality_report(project, issues)
    if not (project.logs_dir / "quality_report.txt").exists():
        issues.append("logs/missing_quality_report_txt")
    return VerificationReport(ok=not issues, issues=issues, checked=checked)


def _verify_manifest(manifest: object, issues: list[str]) -> None:
    work = getattr(manifest, "work")
    if not getattr(work, "source_url", ""):
        issues.append("manifest/missing_source_url")
    if not getattr(work, "license_note", ""):
        issues.append("manifest/missing_license_note")
    policy = getattr(manifest, "source_policy", None)
    if policy is None:
        issues.append("manifest/missing_source_policy")
        return
    if not getattr(policy, "site_name", ""):
        issues.append("manifest/source_policy_missing_site_name")
    if getattr(policy, "grade", "") not in {"A", "B", "C", "D"}:
        issues.append("manifest/source_policy_invalid_grade")
    if not getattr(policy, "auto_fetch_allowed", False) and "body_source=" not in getattr(work, "license_note", ""):
        issues.append("manifest/restricted_source_missing_body_source")
    if getattr(policy, "grade", "") == "B" and getattr(policy, "auto_fetch_allowed", False):
        if not getattr(work, "extra", {}).get("permission_evidence"):
            issues.append("manifest/b_grade_missing_permission_evidence")


def _verify_source_episode(episode_no: int, metadata: dict[str, object], issues: list[str]) -> None:
    paragraphs = metadata.get("paragraphs", [])
    if not isinstance(paragraphs, list) or not paragraphs:
        issues.append(f"source/missing_paragraphs:{episode_no}")
        return
    expected_prefix = f"e{episode_no:03d}-"
    for item in paragraphs:
        if not isinstance(item, dict):
            issues.append(f"source/malformed_paragraph:{episode_no}")
            return
        paragraph_id = str(item.get("id", ""))
        if not paragraph_id.startswith(expected_prefix):
            issues.append(f"source/paragraph_id_mismatch:{episode_no}:{paragraph_id}")
            return


def _verify_source_hash(
    project: Project,
    episode_no: int,
    source_hash: str,
    statuses: dict[int, str],
    issues: list[str],
) -> None:
    if not source_hash:
        issues.append(f"source/missing_hash:{episode_no}")
    rows = project.db.fetch_all("SELECT source_hash FROM episodes WHERE episode_no = ?", (episode_no,))
    if not rows:
        issues.append(f"db/missing_episode:{episode_no}")
        return
    db_hash = str(rows[0]["source_hash"] or "")
    if source_hash and db_hash and source_hash != db_hash:
        issues.append(f"db/source_hash_mismatch:{episode_no}")
    if statuses.get(episode_no) == "completed":
        translation_path = project.translation_path(episode_no)
        if translation_path.exists() and not translation_path.read_text(encoding="utf-8").strip():
            issues.append(f"translation/empty_file:{episode_no}")


def _verify_episode_qa(project: Project, episode_no: int, issues: list[str]) -> None:
    path = project.qa_path(episode_no)
    if not path.exists():
        issues.append(f"logs/missing_episode_qa:{episode_no}")
        return
    try:
        payload = read_json(path, default=None)
    except Exception:
        issues.append(f"logs/malformed_episode_qa:{episode_no}")
        return
    if not isinstance(payload, dict):
        issues.append(f"logs/malformed_episode_qa:{episode_no}")
        return
    try:
        payload_episode_no = int(payload.get("episode_no", -1))
    except (TypeError, ValueError):
        payload_episode_no = -1
    if payload_episode_no != episode_no:
        issues.append(f"logs/episode_qa_mismatch:{episode_no}")


def _verify_quality_report(project: Project, issues: list[str]) -> None:
    try:
        report = read_json(project.logs_dir / "quality_report.json", default=None)
    except Exception:
        issues.append("logs/malformed_quality_report_json")
        return
    if not isinstance(report, dict):
        issues.append("logs/malformed_quality_report_json")
        return
    status_counts = report.get("status_counts")
    if isinstance(status_counts, dict):
        normalized = {str(key): int(value) for key, value in status_counts.items() if isinstance(value, int)}
        if normalized != project.db.counts_by_status():
            issues.append("logs/quality_report_status_counts_mismatch")
    else:
        issues.append("logs/quality_report_missing_status_counts")


def _episode_number_from_translation_path(path: Path) -> int | None:
    stem = path.stem.split(".")[0]
    parts = stem.split("_")
    if len(parts) != 2 or parts[0] != "episode":
        return None
    try:
        return int(parts[1])
    except ValueError:
        return None


def _verify_zip_members(path: Path, required: list[str], issues: list[str], label: str) -> None:
    try:
        with zipfile.ZipFile(path) as archive:
            names = set(archive.namelist())
            for member in required:
                if member not in names:
                    issues.append(f"export/{label}_missing_member:{member}")
            bad_file = archive.testzip()
            if bad_file:
                issues.append(f"export/{label}_bad_zip_member:{bad_file}")
    except zipfile.BadZipFile:
        issues.append(f"export/{label}_bad_zip")
