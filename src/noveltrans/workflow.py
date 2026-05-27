"""High-level workflow helpers used by CLI and tests."""

from __future__ import annotations

import re
import time
from dataclasses import replace
from pathlib import Path

from .connectors import detect_connector
from .config import ConfigManager, CredentialStore
from .estimate import Estimate, estimate_translation
from .errors import PolicyViolation
from .errors import SourceInputError
from .errors import TranslationError
from .exporters import Exporter, normalize_export_formats
from .models import (
    EpisodeText,
    ExportOptions,
    ParallelOptions,
    QualityOptions,
    TranslationOptions,
    WorkMetadata,
)
from .orchestrator import TranslationOrchestrator
from .policy import PolicyEngine
from .preprocessing import normalize_episode
from .project import Project, ProjectManager
from .range_parser import parse_episode_range, parse_single_episode_number
from .translator import CodexCLI, CodexTranslator, DryRunTranslator, OpenAITranslator, Translator
from .translator import normalize_translation_backend
from .utils import atomic_write_json

EXPLICIT_EPISODE_NUMBER_RE = re.compile(
    r"(?:第\s*[0-9０-９一二三四五六七八九十百千〇零]+\s*[話章節]|episode\s*\d+|ep\s*\d+|화\s*\d+)",
    re.IGNORECASE,
)


def create_project_from_local_file(
    *,
    manager: ProjectManager,
    name: str,
    input_path: Path,
    translation: TranslationOptions,
    parallel: ParallelOptions,
    quality: QualityOptions,
    export: ExportOptions,
    episode_spec: str = "all",
) -> Project:
    connector = detect_connector(str(input_path))
    engine = PolicyEngine()
    policy = engine.effective_policy(connector.get_policy())
    engine.assert_can_auto_fetch(policy, user_permission=True)
    work = connector.get_work_metadata(str(input_path))
    episodes = _load_user_file_episodes(input_path, translation, episode_spec)
    project = manager.create_project(name, work, translation, parallel, quality, export, policy)
    _save_project_episodes(project, episodes)
    return project


def create_project_from_url(
    *,
    manager: ProjectManager,
    name: str,
    url: str,
    translation: TranslationOptions,
    parallel: ParallelOptions,
    quality: QualityOptions,
    export: ExportOptions,
    episode_spec: str = "all",
    user_permission: bool = False,
    permission_evidence: str = "",
    fallback_file: Path | None = None,
) -> Project:
    connector = detect_connector(url)
    engine = PolicyEngine()
    policy = engine.effective_policy(connector.get_policy())
    work = connector.get_work_metadata(url)
    episodes: list[EpisodeText] = []
    if fallback_file:
        episodes = _load_user_file_episodes(
            fallback_file,
            translation,
            episode_spec,
            single_episode_no=_requested_single_episode_no(connector, url, work)
            or _single_unmarked_episode_no_from_spec(episode_spec),
        )
        work = WorkMetadata(
            title=work.title,
            author=work.author,
            source_url=url,
            site=work.site,
            work_id=work.work_id,
            license_note=f"{work.license_note}; body_source={fallback_file}",
            collected_at=work.collected_at,
            extra=_extra_with_permission_evidence(work.extra, permission_evidence),
        )
    elif policy.auto_fetch_allowed:
        engine.assert_can_auto_fetch(
            policy,
            user_permission=user_permission,
            permission_evidence=permission_evidence,
        )
        work = _work_with_permission_evidence(work, permission_evidence)
        metadata = connector.list_episodes(url)
        selected = set(parse_episode_range(episode_spec, [item.episode_no for item in metadata]))
        episodes = _fetch_selected_episodes(
            connector=connector,
            metadata=metadata,
            selected=selected,
            translation=translation,
            max_rps=policy.max_rps,
        )
        _assert_translatable_episodes(episodes, url)
    else:
        actions = " / ".join(engine.available_actions(policy))
        raise PolicyViolation(
            f"{policy.site_name}는 자동 본문 수집이 비활성화되어 있습니다. "
            f"사용자 제공 파일이 필요합니다. 가능 작업: {actions}"
        )

    project = manager.create_project(name, work, translation, parallel, quality, export, policy)
    _save_project_episodes(project, episodes)
    return project


def _work_with_permission_evidence(work: WorkMetadata, permission_evidence: str) -> WorkMetadata:
    extra = _extra_with_permission_evidence(work.extra, permission_evidence)
    if extra is work.extra:
        return work
    return WorkMetadata(
        title=work.title,
        author=work.author,
        source_url=work.source_url,
        site=work.site,
        work_id=work.work_id,
        license_note=work.license_note,
        collected_at=work.collected_at,
        extra=extra,
    )


def _extra_with_permission_evidence(extra: dict[str, object], permission_evidence: str) -> dict[str, object]:
    note = permission_evidence.strip()
    if not note:
        return extra
    updated = dict(extra)
    updated["permission_evidence"] = note
    return updated


def add_source_episodes_from_local_file(
    *,
    project: Project,
    input_path: Path,
    episode_spec: str = "all",
    replace_existing: bool = False,
) -> list[int]:
    """Import user-provided source episodes into an existing project.

    By default this is append-only: existing episode numbers are left untouched
    so resume runs translate only newly added source chapters.
    """

    manifest = project.load_manifest()
    episodes = _load_user_file_episodes(input_path, manifest.translation, episode_spec)
    existing_numbers = {episode.episode_no for episode in project.list_source_episodes()}
    work_id = project.db.upsert_work(
        manifest.work.title,
        manifest.work.author,
        manifest.work.source_url,
        manifest.work.site,
    )
    imported: list[int] = []
    for episode in episodes:
        if episode.episode_no in existing_numbers and not replace_existing:
            continue
        project.save_source_episode(episode)
        project.db.upsert_episode(work_id, episode.episode_no, episode.title, episode.source_hash, "pending")
        imported.append(episode.episode_no)
    if imported:
        project.db.audit("source_episodes_imported", ",".join(str(number) for number in sorted(imported)))
    else:
        project.db.audit("source_episodes_import_skipped", str(input_path))
    return sorted(imported)


def _load_user_file_episodes(
    input_path: Path,
    translation: TranslationOptions,
    episode_spec: str,
    single_episode_no: int | None = None,
) -> list[EpisodeText]:
    connector = detect_connector(str(input_path))
    metadata = connector.list_episodes(str(input_path))
    loaded = [connector.fetch_episode(item) for item in metadata]
    loaded = _remap_single_user_episode_if_unmarked(loaded, single_episode_no)
    loaded = [
        normalize_episode(episode, keep_ruby_as_parentheses=translation.keep_ruby_as_parentheses)
        for episode in loaded
    ]
    available = [item.episode_no for item in loaded]
    selected = set(parse_episode_range(episode_spec, available))
    episodes = [episode for episode in loaded if episode.episode_no in selected]
    _assert_translatable_episodes(episodes, input_path)
    return episodes


def _fetch_selected_episodes(
    *,
    connector: object,
    metadata: list[object],
    selected: set[int],
    translation: TranslationOptions,
    max_rps: float,
) -> list[EpisodeText]:
    episodes: list[EpisodeText] = []
    delay = 1.0 / max_rps if max_rps > 0 else 0.0
    last_fetch_at = 0.0
    for item in metadata:
        episode_no = getattr(item, "episode_no")
        if episode_no not in selected:
            continue
        if delay and last_fetch_at:
            elapsed = time.monotonic() - last_fetch_at
            if elapsed < delay:
                time.sleep(delay - elapsed)
        fetched = connector.fetch_episode(item)  # type: ignore[attr-defined]
        last_fetch_at = time.monotonic()
        episodes.append(
            normalize_episode(fetched, keep_ruby_as_parentheses=translation.keep_ruby_as_parentheses)
        )
    return episodes


def _requested_single_episode_no(connector: object, url: str, work: WorkMetadata) -> int | None:
    requested = work.extra.get("requested_episode")
    if isinstance(requested, int) and requested > 0:
        return requested
    try:
        metadata = connector.list_episodes(url)  # type: ignore[attr-defined]
    except Exception:
        return None
    if len(metadata) == 1 and metadata[0].episode_no > 1:
        return metadata[0].episode_no
    return None


def _single_unmarked_episode_no_from_spec(episode_spec: str) -> int | None:
    try:
        return parse_single_episode_number(episode_spec)
    except Exception:
        return None


def _remap_single_user_episode_if_unmarked(
    episodes: list[EpisodeText],
    single_episode_no: int | None,
) -> list[EpisodeText]:
    if not single_episode_no or len(episodes) != 1:
        return episodes
    episode = episodes[0]
    if episode.episode_no != 1 or EXPLICIT_EPISODE_NUMBER_RE.search(episode.title):
        return episodes
    return [
        EpisodeText(
            episode_no=single_episode_no,
            title=episode.title,
            sections=episode.sections,
            source_url=episode.source_url,
            source_hash=episode.source_hash,
            metadata={**episode.metadata, "mapped_from_url_episode_no": single_episode_no},
        )
    ]


def run_translation_and_export(
    project: Project,
    translator: Translator | None = None,
    dry_run: bool = False,
    formats: list[str] | None = None,
    resume: bool = True,
    backend: str | None = None,
) -> list[Path]:
    manifest = project.load_manifest()
    translation_options = manifest.translation
    if backend:
        translation_options = replace(translation_options, backend=normalize_translation_backend(backend))
    elif dry_run:
        translation_options = replace(translation_options, backend="dry-run")
    requested_formats = normalize_export_formats(formats or manifest.export.formats)
    estimate = estimate_project_translation(project, resume=resume)
    if resume and estimate.episode_count == 0:
        return Exporter().export(project, formats=requested_formats)
    translator = translator or build_translator(translation_options, dry_run=dry_run)
    orchestrator = TranslationOrchestrator(
        project=project,
        translator=translator,
        translation_options=translation_options,
        parallel_options=manifest.parallel,
        quality_options=manifest.quality,
    )
    orchestrator.run_sync(resume=resume)
    failed = project.db.counts_by_status().get("failed", 0)
    if failed:
        raise TranslationError(f"{failed}개 화 번역이 실패했습니다. 로그를 확인한 뒤 기존 프로젝트 이어서 번역을 실행하세요.")
    return Exporter().export(project, formats=requested_formats)


def estimate_project_translation(project: Project, resume: bool = True) -> Estimate:
    manifest = project.load_manifest()
    config = ConfigManager().load()
    episodes = project.list_source_episodes()
    if resume:
        statuses = project.db.episode_statuses()
        episodes = [
            episode
            for episode in episodes
            if not (
                statuses.get(episode.episode_no) == "completed"
                and project.translation_path(episode.episode_no).exists()
            )
        ]
    estimate = estimate_translation(
        episodes,
        manifest.translation,
        input_price_per_million_tokens=config.input_price_per_million_tokens,
        output_price_per_million_tokens=config.output_price_per_million_tokens,
    )
    atomic_write_json(project.logs_dir / "estimate.json", estimate.to_dict())
    return estimate


def build_translator(options: TranslationOptions, dry_run: bool = False) -> Translator:
    if dry_run:
        return DryRunTranslator()
    backend = normalize_translation_backend(options.backend)
    if backend == "dry-run":
        return DryRunTranslator()
    config = ConfigManager().load()
    if backend == "codex":
        return _build_codex_translator(config)
    api_key = CredentialStore().get_api_key()
    access_token = "" if api_key else CredentialStore().get_access_token()
    if backend == "auto" and not api_key and not access_token:
        codex = CodexCLI(command=config.codex_command, timeout=config.codex_timeout_seconds)
        authenticated, _ = codex.login_status()
        if authenticated:
            return CodexTranslator(codex)
    if not api_key and not access_token:
        if backend == "auto":
            raise PolicyViolation(
                "OpenAI API key/access token도 없고 Codex CLI 로그인도 확인되지 않았습니다. "
                "`codex login` 후 --backend codex 또는 --backend auto를 사용하거나 dry-run을 선택하세요."
            )
        raise PolicyViolation(
            "OpenAI API key 또는 호환 OAuth/Bearer access token이 설정되어 있지 않습니다. "
            "설정 메뉴에서 저장하거나 OPENAI_API_KEY를 지정하세요."
        )
    return OpenAITranslator(
        api_key=api_key or access_token,
        organization=config.openai_organization,
        project=config.openai_project,
    )


def _build_codex_translator(config: object) -> CodexTranslator:
    codex = CodexCLI(
        command=getattr(config, "codex_command", "codex"),
        timeout=getattr(config, "codex_timeout_seconds", 600),
    )
    authenticated, detail = codex.login_status()
    if not authenticated:
        raise PolicyViolation(
            "Codex CLI 로그인이 필요합니다. `codex login`을 실행한 뒤 다시 시도하세요. "
            f"상태: {detail}"
        )
    return CodexTranslator(codex)


def _save_project_episodes(project: Project, episodes: list[EpisodeText]) -> None:
    manifest = project.load_manifest()
    work_id = project.db.upsert_work(
        manifest.work.title,
        manifest.work.author,
        manifest.work.source_url,
        manifest.work.site,
    )
    for episode in episodes:
        project.save_source_episode(episode)
        project.db.upsert_episode(work_id, episode.episode_no, episode.title, episode.source_hash, "pending")
    project.db.audit("source_episodes_saved", str(len(episodes)))


def _assert_translatable_episodes(episodes: list[EpisodeText], source: Path | str) -> None:
    if not episodes:
        raise SourceInputError(f"번역할 수 있는 화를 찾지 못했습니다: {source}")
    empty = [episode.episode_no for episode in episodes if not episode.all_text().strip()]
    if empty:
        formatted = ", ".join(str(number) for number in empty[:10])
        raise SourceInputError(f"본문이 비어 있는 화가 있습니다: {formatted}")
