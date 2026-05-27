"""NovelTrans command line entry points."""

from __future__ import annotations

import argparse
import getpass
import os
import platform
import shlex
import subprocess
import sys
import tempfile
import webbrowser
from pathlib import Path
from threading import Thread
from time import monotonic
from typing import Callable

from . import __version__
from .config import AppConfig, ConfigManager, CredentialStore
from .connectors import detect_connector, get_connectors
from .errors import ConfigurationError, NovelTransError, PolicyViolation
from .exporters import Exporter
from .glossary import GlossaryManager
from .models import (
    ExportOptions,
    GlossaryEntry,
    ParallelOptions,
    QualityOptions,
    TranslationOptions,
)
from .policy import SAFE_POLICY_TEXT, PolicyEngine
from .policy_registry import PolicyRegistry
from .progress import format_progress_line, snapshot_project_progress, target_episode_numbers
from .project import Project, ProjectManager
from .translator import CodexCLI, normalize_translation_backend
from .verify import verify_project
from .workflow import (
    add_source_episodes_from_local_file,
    create_project_from_local_file,
    create_project_from_url,
    estimate_project_translation,
    run_translation_and_export,
)


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv and argv[0] == "run-local":
        return _run_local(argv[1:])
    if argv and argv[0] == "run-url":
        return _run_url(argv[1:])
    if argv and argv[0] == "add-source":
        return _add_source(argv[1:])
    if argv and argv[0] == "export":
        return _export_project(argv[1:])
    if argv and argv[0] == "status":
        return _status_project(argv[1:])
    if argv and argv[0] == "estimate":
        return _estimate_project(argv[1:])
    if argv and argv[0] == "report":
        return _report_project(argv[1:])
    if argv and argv[0] == "verify":
        return _verify_project(argv[1:])
    if argv and argv[0] == "auth":
        return _auth(argv[1:])
    if argv and argv[0] == "policy":
        return _policy(argv[1:])
    if argv and argv[0] == "doctor":
        return _doctor(argv[1:])
    parser = argparse.ArgumentParser(description="NovelTrans CLI")
    parser.add_argument("--version", action="store_true", help="print version and exit")
    parser.add_argument("--classic", action="store_true", help="use the legacy numbered prompt UI")
    args = parser.parse_args(argv)
    if args.version:
        print(__version__)
        return 0
    try:
        if args.classic:
            return interactive_main()
        return _run_wizard_ui()
    except (KeyboardInterrupt, EOFError):
        print("\n취소했습니다.")
        return 130
    except NovelTransError as exc:
        print(f"오류: {exc}", file=sys.stderr)
        return 1
    except OSError as exc:
        print(f"파일 오류: {exc}", file=sys.stderr)
        return 1


def _run_wizard_ui() -> int:
    from .wizard import wizard_main

    return wizard_main()


def interactive_main() -> int:
    config_manager = ConfigManager()
    config = config_manager.load()
    manager = ProjectManager(config.base_dir)
    while True:
        print("\nNovelTrans CLI")
        print("1. 새 번역 프로젝트 만들기")
        print("2. 기존 프로젝트 이어서 번역")
        print("3. 용어집 관리")
        print("4. 출력 파일 다시 생성")
        print("5. 설정")
        print("0. 종료")
        choice = _ask("선택", "1")
        try:
            if choice == "1":
                _new_project_flow(manager, config)
            elif choice == "2":
                _resume_project_flow(manager)
            elif choice == "3":
                _glossary_flow(manager)
            elif choice == "4":
                _regenerate_exports_flow(manager)
            elif choice == "5":
                config = _settings_flow(config_manager, config)
                manager = ProjectManager(config.base_dir)
            elif choice == "0":
                return 0
        except NovelTransError as exc:
            print(f"오류: {exc}")
        except OSError as exc:
            print(f"파일 오류: {exc}")


def _new_project_flow(manager: ProjectManager, config: AppConfig) -> None:
    print("\n안전 정책")
    print(SAFE_POLICY_TEXT)
    if not _confirm("나는 이 텍스트를 번역할 권한이 있다", default=False):
        raise PolicyViolation("권한 확인이 필요합니다.")
    if not _confirm("결과물을 무단 배포하지 않는다", default=False):
        raise PolicyViolation("재배포 금지 확인이 필요합니다.")

    name = _ask("프로젝트 이름", "my_novel")
    print("\n원본 입력 방식")
    print("1. URL 입력")
    print("2. TXT/HTML 파일 불러오기")
    print("3. ZIP 파일 불러오기")
    print("4. 클립보드/붙여넣기")
    print("5. 터미널에서 직접 입력")
    print("6. 외부 편집기로 작성")
    input_choice = _ask("선택", "1")
    episode_spec = _choose_episode_spec("번역할 화수 범위")
    translation, parallel, quality, export = _collect_options(config)

    if input_choice == "1":
        url = _ask("소설 URL")
        connector = detect_connector(url)
        policy_engine = PolicyEngine()
        policy = policy_engine.effective_policy(connector.get_policy())
        print("\n사이트 감지")
        print(policy_engine.describe(policy))
        fallback_file = None
        user_permission = _confirm("이 URL의 자동 수집 조건을 충족하며 처리 권한이 있다", default=False)
        permission_evidence = ""
        if user_permission or policy.requires_user_permission:
            print("권한/라이선스 근거 메모 예: author permission, public domain, authorized personal use")
            permission_evidence = _ask("권한/라이선스 근거 메모", "user confirmed authorized personal use")
        if not policy.auto_fetch_allowed:
            print("자동 본문 수집이 금지된 사이트입니다. 사용자가 제공한 원문만 처리할 수 있습니다.")
            fallback_file = _collect_user_provided_source_file()
        project = create_project_from_url(
            manager=manager,
            name=name,
            url=url,
            translation=translation,
            parallel=parallel,
            quality=quality,
            export=export,
            episode_spec=episode_spec,
            user_permission=user_permission,
            permission_evidence=permission_evidence,
            fallback_file=fallback_file,
        )
    elif input_choice in {"2", "3"}:
        path = Path(_ask("파일 경로")).expanduser()
        project = create_project_from_local_file(
            manager=manager,
            name=name,
            input_path=path,
            translation=translation,
            parallel=parallel,
            quality=quality,
            export=export,
            episode_spec=episode_spec,
        )
    elif input_choice == "4":
        path = _capture_text_to_temp_file(_read_clipboard_or_paste(), suffix=".txt")
        project = create_project_from_local_file(
            manager=manager,
            name=name,
            input_path=path,
            translation=translation,
            parallel=parallel,
            quality=quality,
            export=export,
            episode_spec=episode_spec,
        )
    elif input_choice == "5":
        path = _capture_text_to_temp_file(_read_multiline_text(), suffix=".txt")
        project = create_project_from_local_file(
            manager=manager,
            name=name,
            input_path=path,
            translation=translation,
            parallel=parallel,
            quality=quality,
            export=export,
            episode_spec=episode_spec,
        )
    elif input_choice == "6":
        path = _capture_editor_text_to_temp_file()
        project = create_project_from_local_file(
            manager=manager,
            name=name,
            input_path=path,
            translation=translation,
            parallel=parallel,
            quality=quality,
            export=export,
            episode_spec=episode_spec,
        )
    else:
        print("알 수 없는 선택입니다.")
        return

    _print_estimate(estimate_project_translation(project, resume=False))
    dry_run = _choose_translation_backend(translation.backend)
    outputs = _run_translation_with_progress_cli(
        project,
        backend="dry-run" if dry_run else translation.backend,
        resume=False,
        runner=lambda: run_translation_and_export(project, dry_run=dry_run),
    )
    print("\n완료")
    print(f"프로젝트: {project.root}")
    for output in outputs:
        print(f"- {output}")


def _resume_project_flow(manager: ProjectManager) -> None:
    project = _select_project(manager)
    manifest = project.load_manifest()
    print(f"\n프로젝트: {manifest.name}")
    _print_project_status(project)
    if _confirm("새로 저장한 원문 파일에서 추가 화를 가져올까요", default=False):
        source_path = Path(_ask("TXT/HTML/ZIP 파일 경로")).expanduser()
        episode_spec = _choose_episode_spec("가져올 화수 범위")
        replace_existing = _confirm("기존 화 번호도 새 원문으로 교체할까요", default=False)
        imported = add_source_episodes_from_local_file(
            project=project,
            input_path=source_path,
            episode_spec=episode_spec,
            replace_existing=replace_existing,
        )
        if imported:
            print("가져온 화: " + ", ".join(str(number) for number in imported))
        else:
            print("새로 가져올 화가 없습니다.")
        print("\n갱신 상태")
        _print_project_status(project)
    _print_estimate(estimate_project_translation(project, resume=True))
    dry_run = _choose_translation_backend(manifest.translation.backend)
    outputs = _run_translation_with_progress_cli(
        project,
        backend="dry-run" if dry_run else manifest.translation.backend,
        resume=True,
        runner=lambda: run_translation_and_export(project, dry_run=dry_run, resume=True),
    )
    print("이어 번역 및 출력 생성 완료")
    for output in outputs:
        print(f"- {output}")


def _glossary_flow(manager: ProjectManager) -> None:
    project = _select_project(manager)
    glossary = GlossaryManager(project.glossary_dir)
    while True:
        entries = glossary.snapshot(limit=20)
        print("\n용어집")
        if not entries:
            print("(비어 있음)")
        for entry in entries:
            locked = "잠금" if entry.locked else "편집"
            target = entry.target or "(번역 대기)"
            print(f"- {entry.source} -> {target} [{entry.type}, {locked}, {entry.confidence:.2f}]")
        print("1. 용어 추가/수정")
        print("2. 용어 잠금")
        print("3. 충돌 보기/해결")
        print("0. 돌아가기")
        choice = _ask("선택", "0")
        if choice == "1":
            source = _ask("원문 용어")
            target = _ask("한국어 번역")
            term_type = _choose_term_type()
            glossary.add_or_update(
                GlossaryEntry(
                    source=source,
                    target=target,
                    type=term_type,
                    confidence=1.0,
                    locked=_confirm("잠금", default=True),
                    notes="user provided",
                )
            )
            _sync_glossary_to_project_db(project, glossary)
        elif choice == "2":
            source = _ask("잠글 원문 용어")
            if not glossary.lock_term(source):
                print("해당 용어를 찾지 못했습니다.")
            else:
                _sync_glossary_to_project_db(project, glossary)
        elif choice == "3":
            _glossary_conflict_flow(project, glossary)
        elif choice == "0":
            return


def _regenerate_exports_flow(manager: ProjectManager) -> None:
    project = _select_project(manager)
    outputs = Exporter().export(project, formats=_choose_formats())
    print("출력 파일 생성 완료")
    for output in outputs:
        print(f"- {output}")


def _sync_glossary_to_project_db(project: Project, glossary: GlossaryManager) -> None:
    for entry in glossary.snapshot(limit=10_000):
        project.db.upsert_glossary_entry(entry.source, entry.target, entry.type, entry.confidence, entry.locked)


def _glossary_conflict_flow(project: Project, glossary: GlossaryManager) -> None:
    conflicts = glossary.conflict_snapshot(limit=50)
    if not conflicts:
        print("용어 충돌이 없습니다.")
        return
    print("\n용어 충돌")
    for index, conflict in enumerate(conflicts, start=1):
        print(
            f"{index}. {conflict.source}: 기존 '{conflict.previous}' / 새 제안 '{conflict.suggested}' "
            f"({conflict.recommendation})"
        )
    selected = _ask_int("해결할 충돌 번호", 1, 1, len(conflicts))
    conflict = conflicts[selected - 1]
    print("1. 기존 번역 유지")
    print("2. 새 번역으로 적용")
    print("3. 기존 번역 유지하고 잠금")
    action_choice = _ask("선택", "1")
    action = {
        "1": "keep_previous",
        "2": "use_suggested",
        "3": "keep_and_lock",
    }.get(action_choice, "keep_previous")
    if glossary.resolve_conflict(conflict.source, action):
        _sync_glossary_to_project_db(project, glossary)
        print("충돌을 해결했습니다.")
    else:
        print("충돌을 해결하지 못했습니다.")


def _print_estimate(estimate: object) -> None:
    episode_count = getattr(estimate, "episode_count")
    total_tokens = getattr(estimate, "estimated_total_tokens")
    input_tokens = getattr(estimate, "estimated_input_tokens")
    output_tokens = getattr(estimate, "estimated_output_tokens")
    estimated_cost = getattr(estimate, "estimated_cost")
    print("\n토큰/비용 추정")
    print(f"- 대상 화수: {episode_count}")
    print(f"- 입력/출력/합계 토큰: {input_tokens} / {output_tokens} / {total_tokens}")
    if estimated_cost is not None:
        print(f"- 예상 비용: ${estimated_cost:.4f}")
    else:
        print("- 예상 비용: 단가 미설정")


def _run_translation_with_progress_cli(
    project: Project,
    backend: str,
    resume: bool,
    runner: Callable[[], list[Path]],
) -> list[Path]:
    target_numbers = target_episode_numbers(project, resume=resume)
    started_at = monotonic()
    state: dict[str, object] = {}

    def worker() -> None:
        try:
            state["outputs"] = runner()
        except Exception as exc:  # noqa: BLE001 - re-raised after progress loop.
            state["error"] = exc

    print("\n번역 진행")
    print("대기/진행/완료 상태를 1초마다 갱신합니다.")
    thread = Thread(target=worker, daemon=True)
    thread.start()
    while thread.is_alive():
        snapshot = snapshot_project_progress(project, target_numbers, started_at)
        print(format_progress_line(snapshot, backend=backend), flush=True)
        thread.join(timeout=1.0)
    snapshot = snapshot_project_progress(project, target_numbers, started_at)
    print(format_progress_line(snapshot, backend=backend), flush=True)
    if "error" in state:
        raise state["error"]  # type: ignore[misc]
    return list(state.get("outputs", []))


def _print_project_status(project: Project) -> None:
    status = _project_status(project)
    print(f"상태: {status['counts']}")
    for label, numbers in (
        ("완료", status["completed"]),
        ("실패", status["failed"]),
        ("미번역", status["pending"]),
    ):
        print(f"- {label}: {_format_episode_numbers(numbers)}")


def _project_status(project: Project) -> dict[str, object]:
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
    counts = {
        "completed": len(completed),
        "failed": len(failed),
        "pending": len(pending),
    }
    return {
        "counts": counts,
        "completed": completed,
        "failed": failed,
        "pending": pending,
    }


def _format_episode_numbers(numbers: object) -> str:
    values = sorted(int(number) for number in numbers) if isinstance(numbers, list) else []
    if not values:
        return "없음"
    ranges: list[str] = []
    start = previous = values[0]
    for number in values[1:]:
        if number == previous + 1:
            previous = number
            continue
        ranges.append(_format_episode_range(start, previous))
        start = previous = number
    ranges.append(_format_episode_range(start, previous))
    return ", ".join(ranges)


def _format_episode_range(start: int, end: int) -> str:
    return str(start) if start == end else f"{start}-{end}"


def _settings_flow(config_manager: ConfigManager, config: AppConfig) -> AppConfig:
    store = CredentialStore(config_manager.config_dir)
    while True:
        has_key = bool(store.get_api_key())
        has_token = bool(store.get_access_token())
        print("\n설정")
        print(f"1. 프로젝트 기본 디렉터리: {config.base_dir}")
        print(f"2. 기본 모델: {config.default_model}")
        print(f"3. 기본 동시 번역 화수: {config.default_parallel_episodes}")
        print(f"4. OpenAI API key: {'설정됨' if has_key else '없음'}")
        print(f"5. OpenAI OAuth/Bearer access token: {'설정됨' if has_token else '없음'}")
        print(f"6. 워터마크: {config.watermark}")
        print(f"7. OpenAI 조직 ID: {config.openai_organization or '(없음)'}")
        print(f"8. OpenAI 프로젝트 ID: {config.openai_project or '(없음)'}")
        print(f"9. 입력 토큰 단가/100만: {config.input_price_per_million_tokens}")
        print(f"10. 출력 토큰 단가/100만: {config.output_price_per_million_tokens}")
        print(f"11. 사이트 정책 업데이트 URL: {config.policy_update_url or '(없음)'}")
        print("12. 사이트 정책 업데이트 가져오기")
        print(f"13. 기본 번역 백엔드: {config.default_translation_backend}")
        print(f"14. Codex CLI 명령: {config.codex_command}")
        print(f"15. Codex exec 제한 시간(초): {config.codex_timeout_seconds}")
        print("0. 돌아가기")
        choice = _ask("선택", "0")
        if choice == "1":
            config.base_dir = _ask("프로젝트 기본 디렉터리", config.base_dir)
        elif choice == "2":
            config.default_model = _choose_model(config.default_model, "기본 모델")
        elif choice == "3":
            config.default_parallel_episodes = _choose_concurrency(config.default_parallel_episodes)
        elif choice == "4":
            if _confirm("API key를 새로 저장할까요", default=True):
                backend = store.set_api_key(getpass.getpass("OpenAI API key: "))
                print(f"저장 위치: {backend}")
            elif _confirm("저장된 API key를 삭제할까요", default=False):
                store.clear_api_key()
        elif choice == "5":
            if _confirm("OAuth/Bearer access token을 새로 저장할까요", default=True):
                backend = store.set_access_token(getpass.getpass("OpenAI access token: "))
                print(f"저장 위치: {backend}")
            elif _confirm("저장된 access token을 삭제할까요", default=False):
                store.clear_access_token()
        elif choice == "6":
            config.watermark = _ask("워터마크", config.watermark)
        elif choice == "7":
            config.openai_organization = _ask("OpenAI 조직 ID", config.openai_organization)
        elif choice == "8":
            config.openai_project = _ask("OpenAI 프로젝트 ID", config.openai_project)
        elif choice == "9":
            config.input_price_per_million_tokens = _ask_float(
                "입력 토큰 단가/100만",
                config.input_price_per_million_tokens,
                minimum=0.0,
            )
        elif choice == "10":
            config.output_price_per_million_tokens = _ask_float(
                "출력 토큰 단가/100만",
                config.output_price_per_million_tokens,
                minimum=0.0,
            )
        elif choice == "11":
            config.policy_update_url = _ask("정책 업데이트 HTTPS URL", config.policy_update_url)
        elif choice == "12":
            _policy_update_flow(config_manager)
        elif choice == "13":
            config.default_translation_backend = _choose_backend(config.default_translation_backend)
        elif choice == "14":
            config.codex_command = _ask("Codex CLI 명령", config.codex_command)
        elif choice == "15":
            config.codex_timeout_seconds = _ask_int(
                "Codex exec 제한 시간(초)",
                config.codex_timeout_seconds,
                30,
                7200,
            )
        elif choice == "0":
            config_manager.save(config)
            return config
        config_manager.save(config)


def _policy_update_flow(config_manager: ConfigManager) -> None:
    registry = PolicyRegistry(config_manager.config_dir / "policies.json")
    print("1. 로컬 JSON 파일에서 가져오기")
    print("2. HTTPS URL에서 가져오기")
    choice = _ask("선택", "1")
    if choice == "1":
        count = registry.import_file(Path(_ask("정책 JSON 파일 경로")).expanduser())
    elif choice == "2":
        count = registry.import_url(_ask("정책 JSON URL"))
    else:
        print("취소했습니다.")
        return
    print(f"{count}개 사이트 정책을 업데이트했습니다.")


def _select_project(manager: ProjectManager) -> Project:
    projects = manager.list_projects()
    if not projects:
        raise NovelTransError("프로젝트가 없습니다.")
    print("\n프로젝트 선택")
    for index, project in enumerate(projects, start=1):
        try:
            manifest = project.load_manifest()
            label = manifest.name
        except Exception:
            label = project.root.name
        print(f"{index}. {label} ({project.root})")
    choice = _ask_int("선택", 1, 1, len(projects))
    return projects[choice - 1]


def _collect_options(config: AppConfig) -> tuple[TranslationOptions, ParallelOptions, QualityOptions, ExportOptions]:
    preset = _ask_choice(
        "번역 모드",
        [
            ("빠른 초벌 번역", "fast", "속도 우선"),
            ("균형 번역", "balanced", "일반 추천값"),
            ("문학적 자연화", "literary", "한국 웹소설 문체 자연화"),
            ("직역 보존", "literal", "원문 구조 최대 보존"),
            ("용어 일관성 최우선", "glossary", "고유명사/설정 일관성 강화"),
            ("커스텀", "custom", "세부 옵션 직접 지정"),
        ],
        "balanced",
        help_text="처음이면 균형 번역을 고르세요.",
    )
    model = _choose_model(config.default_model)
    backend = _choose_backend(config.default_translation_backend)
    concurrency = _choose_concurrency(config.default_parallel_episodes)
    formats = _choose_formats()
    translation = _translation_options_for_preset(preset, model, config.default_reasoning_effort)
    translation.backend = backend
    parallel = ParallelOptions(max_parallel_episodes=concurrency)
    quality = QualityOptions()
    export = ExportOptions(
        formats=formats,
        watermark=config.watermark,
    )
    if preset == "custom":
        _customize_options(translation, parallel, quality, export)
    return translation, parallel, quality, export


def _choose_backend(default: str = "openai") -> str:
    default = normalize_translation_backend(default)
    return _ask_choice(
        "번역 백엔드",
        [
            ("자동 선택", "auto", "OpenAI 자격 증명 우선, 없으면 Codex CLI"),
            ("OpenAI API key/access token", "openai", "저장된 API key 또는 access token 사용"),
            ("Codex CLI 로그인", "codex", "`codex login` 세션 사용"),
            ("Dry-run", "dry-run", "실제 번역 없이 파일 생성 흐름 검증"),
        ],
        default,
        help_text="잘 모르겠으면 자동 선택을 쓰세요.",
    )


def _translation_options_for_preset(preset: str, model: str, reasoning_effort: str) -> TranslationOptions:
    options = TranslationOptions(model=model, reasoning_effort=reasoning_effort, preset=preset)
    if preset == "fast":
        options.reasoning_effort = "low"
        options.glossary_strictness = "medium"
        options.temperature = 0.2
    elif preset == "literary":
        options.style = "korean_webnovel_literary_naturalized"
        options.temperature = 0.45
    elif preset == "literal":
        options.style = "literal_structure_preserving"
        options.temperature = 0.2
    elif preset == "glossary":
        options.style = "korean_webnovel_term_consistency_first"
        options.glossary_strictness = "strict"
        options.temperature = 0.1
    return options


def _customize_options(
    translation: TranslationOptions,
    parallel: ParallelOptions,
    quality: QualityOptions,
    export: ExportOptions,
) -> None:
    translation.reasoning_effort = _choose_reasoning_effort(translation.reasoning_effort)
    translation.style = _choose_style(translation.style)
    translation.honorific_policy = _choose_honorific_policy(translation.honorific_policy)
    translation.preserve_japanese_suffixes = _confirm("일본어 호칭 접미사 보존", translation.preserve_japanese_suffixes)
    translation.translate_author_notes = _confirm("작가 후기 번역", translation.translate_author_notes)
    translation.keep_ruby_as_parentheses = _confirm("루비를 괄호로 보존", translation.keep_ruby_as_parentheses)
    translation.glossary_strictness = _choose_glossary_strictness(translation.glossary_strictness)
    translation.temperature = _choose_temperature(translation.temperature)
    parallel.split_long_episode = _confirm("긴 화를 내부 분할", parallel.split_long_episode)
    if parallel.split_long_episode:
        parallel.long_episode_threshold_chars = _choose_long_episode_threshold(parallel.long_episode_threshold_chars)
    quality.run_qa_pass = _confirm("QA 패스 실행", quality.run_qa_pass)
    quality.run_term_consistency_pass = _confirm("용어 일관성 검사", quality.run_term_consistency_pass)
    quality.check_missing_paragraphs = _confirm("누락 문단 검사", quality.check_missing_paragraphs)
    quality.compare_length_ratio = _confirm("길이 비율 검사", quality.compare_length_ratio)
    banned = _ask("금칙어 (쉼표 구분, 없으면 빈 값)", "")
    quality.banned_terms = [item.strip() for item in banned.split(",") if item.strip()]
    export.include_glossary = _confirm("용어집 부록 포함", export.include_glossary)
    export.include_author_notes = _confirm("출력에 작가 후기 포함", export.include_author_notes)
    export.epub_vertical_writing = _confirm("EPUB 세로쓰기", export.epub_vertical_writing)


def _choose_translation_backend(backend: str = "openai") -> bool:
    backend = normalize_translation_backend(backend)
    if backend == "dry-run":
        return True
    if backend == "codex":
        return False
    if backend == "auto" and _has_codex_credentials():
        return False
    if _has_openai_credentials(CredentialStore()):
        return False
    print("OpenAI API key 또는 OAuth/Bearer access token이 없어 dry-run 모드로 실행할 수 있습니다.")
    if backend == "auto":
        print("Codex CLI 로그인도 확인되지 않았습니다. `codex login` 후 Codex 백엔드를 사용할 수 있습니다.")
    print("dry-run은 파일 생성과 QA 흐름만 검증하며 실제 번역을 수행하지 않습니다.")
    if _confirm("dry-run으로 진행", default=True):
        return True
    raise PolicyViolation("OpenAI API key, 호환 OAuth/Bearer access token, 또는 Codex CLI 로그인이 필요합니다.")


def _has_openai_credentials(store: CredentialStore) -> bool:
    return bool(store.get_api_key() or store.get_access_token())


def _has_codex_credentials() -> bool:
    authenticated, _ = CodexCLI().login_status()
    return authenticated


def _read_clipboard_or_paste() -> str:
    try:
        import tkinter  # type: ignore

        root = tkinter.Tk()
        root.withdraw()
        text = root.clipboard_get()
        root.destroy()
        if text.strip():
            return text
    except Exception:
        pass
    print("클립보드를 읽지 못했습니다.")
    return _read_multiline_text()


def _read_multiline_text() -> str:
    print("본문을 입력하세요. 마지막 줄에 ::end 를 입력하면 종료합니다.")
    lines: list[str] = []
    while True:
        line = input()
        if line.strip() == "::end":
            break
        lines.append(line)
    return "\n".join(lines)


def _collect_user_provided_source_file() -> Path:
    print("\n원문 제공 방식")
    print("1. TXT/HTML/ZIP 파일 경로")
    print("2. 클립보드/붙여넣기")
    print("3. 터미널에서 직접 입력")
    print("4. 외부 편집기로 작성")
    choice = _ask("선택", "1")
    if choice == "1":
        return Path(_ask("TXT/HTML/ZIP 파일 경로")).expanduser()
    if choice == "2":
        return _capture_text_to_temp_file(_read_clipboard_or_paste(), suffix=".txt")
    if choice == "3":
        return _capture_text_to_temp_file(_read_multiline_text(), suffix=".txt")
    if choice == "4":
        return _capture_editor_text_to_temp_file()
    raise NovelTransError("알 수 없는 원문 제공 방식입니다.")


def _capture_text_to_temp_file(text: str, suffix: str) -> Path:
    if not text.strip():
        raise NovelTransError("입력 본문이 비어 있습니다.")
    handle = tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=suffix, prefix="noveltrans_", delete=False)
    with handle:
        handle.write(text)
    return Path(handle.name)


def _capture_editor_text_to_temp_file(initial_text: str = "") -> Path:
    editor = os.environ.get("VISUAL") or os.environ.get("EDITOR")
    if not editor:
        raise NovelTransError("외부 편집기 입력에는 VISUAL 또는 EDITOR 환경 변수가 필요합니다.")
    handle = tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".txt", prefix="noveltrans_edit_", delete=False)
    with handle:
        handle.write(initial_text)
    path = Path(handle.name)
    command = [*shlex.split(editor), str(path)]
    try:
        completed = subprocess.run(command, check=False)
    except OSError as exc:
        raise NovelTransError(f"편집기를 실행하지 못했습니다: {editor}") from exc
    if completed.returncode != 0:
        raise NovelTransError(f"편집기가 실패했습니다: exit={completed.returncode}")
    if not path.read_text(encoding="utf-8").strip():
        raise NovelTransError("편집기에서 저장한 본문이 비어 있습니다.")
    return path


def _run_local(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Run a local-file translation workflow.")
    parser.add_argument("--name", required=True)
    parser.add_argument("--input", required=True)
    parser.add_argument("--base-dir", default="projects")
    parser.add_argument("--episodes", default="all")
    parser.add_argument("--formats", default="txt,docx,epub")
    parser.add_argument("--model", default="gpt-5.5")
    parser.add_argument("--parallel", type=int, default=4)
    parser.add_argument("--backend", default="openai", help="translation backend: openai, codex, auto, or dry-run")
    parser.add_argument("--dry-run", action="store_true")
    _add_rights_confirmation_args(parser)
    args = parser.parse_args(argv)
    try:
        _validate_parallel_arg(args.parallel)
        _assert_usage_confirmed(args.confirm_rights, args.no_redistribute)
        config = AppConfig(base_dir=args.base_dir, default_model=args.model, default_parallel_episodes=args.parallel)
        backend = normalize_translation_backend(args.backend)
        translation = TranslationOptions(model=args.model, backend=backend)
        parallel = ParallelOptions(max_parallel_episodes=args.parallel)
        quality = QualityOptions()
        export = ExportOptions(formats=[item.strip() for item in args.formats.split(",") if item.strip()])
        project = create_project_from_local_file(
            manager=ProjectManager(config.base_dir),
            name=args.name,
            input_path=Path(args.input).expanduser(),
            translation=translation,
            parallel=parallel,
            quality=quality,
            export=export,
            episode_spec=args.episodes,
        )
        outputs = run_translation_and_export(project, dry_run=args.dry_run, backend=backend)
        print(project.root)
        for output in outputs:
            print(output)
        return 0
    except NovelTransError as exc:
        print(f"오류: {exc}", file=sys.stderr)
        return 1
    except OSError as exc:
        print(f"파일 오류: {exc}", file=sys.stderr)
        return 1


def _run_url(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Run a URL-based translation workflow.")
    parser.add_argument("--name", required=True)
    parser.add_argument("--url", required=True)
    parser.add_argument("--fallback-file", default="")
    parser.add_argument("--base-dir", default="projects")
    parser.add_argument("--episodes", default="all")
    parser.add_argument("--formats", default="txt,docx,epub")
    parser.add_argument("--model", default="gpt-5.5")
    parser.add_argument("--parallel", type=int, default=4)
    parser.add_argument("--backend", default="openai", help="translation backend: openai, codex, auto, or dry-run")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--allow-auto-fetch", action="store_true")
    parser.add_argument("--permission-note", default="", help="rights/API/permission note for policy audit")
    _add_rights_confirmation_args(parser)
    args = parser.parse_args(argv)
    try:
        _validate_parallel_arg(args.parallel)
        _assert_usage_confirmed(args.confirm_rights, args.no_redistribute)
        config = AppConfig(base_dir=args.base_dir, default_model=args.model, default_parallel_episodes=args.parallel)
        backend = normalize_translation_backend(args.backend)
        translation = TranslationOptions(model=args.model, backend=backend)
        parallel = ParallelOptions(max_parallel_episodes=args.parallel)
        quality = QualityOptions()
        export = ExportOptions(formats=[item.strip() for item in args.formats.split(",") if item.strip()])
        project = create_project_from_url(
            manager=ProjectManager(config.base_dir),
            name=args.name,
            url=args.url,
            translation=translation,
            parallel=parallel,
            quality=quality,
            export=export,
            episode_spec=args.episodes,
            user_permission=args.allow_auto_fetch,
            permission_evidence=args.permission_note,
            fallback_file=Path(args.fallback_file).expanduser() if args.fallback_file else None,
        )
        outputs = run_translation_and_export(project, dry_run=args.dry_run, backend=backend)
        print(project.root)
        for output in outputs:
            print(output)
        return 0
    except NovelTransError as exc:
        print(f"오류: {exc}", file=sys.stderr)
        return 1
    except OSError as exc:
        print(f"파일 오류: {exc}", file=sys.stderr)
        return 1


def _add_source(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Add local source episodes to an existing project.")
    parser.add_argument("--project", required=True, help="project slug or project path")
    parser.add_argument("--input", required=True)
    parser.add_argument("--base-dir", default="projects")
    parser.add_argument("--episodes", default="all")
    parser.add_argument("--replace-existing", action="store_true")
    parser.add_argument("--translate", action="store_true", help="translate pending/failed episodes after import")
    parser.add_argument("--formats", default="")
    parser.add_argument("--backend", default="", help="override translation backend: openai, codex, auto, or dry-run")
    parser.add_argument("--dry-run", action="store_true")
    _add_rights_confirmation_args(parser)
    args = parser.parse_args(argv)
    try:
        _assert_usage_confirmed(args.confirm_rights, args.no_redistribute)
        project = ProjectManager(args.base_dir).get_project(args.project)
        imported = add_source_episodes_from_local_file(
            project=project,
            input_path=Path(args.input).expanduser(),
            episode_spec=args.episodes,
            replace_existing=args.replace_existing,
        )
        print(project.root)
        print("imported=" + ",".join(str(number) for number in imported))
        if args.translate:
            formats = [item.strip() for item in args.formats.split(",") if item.strip()] or None
            outputs = run_translation_and_export(
                project,
                dry_run=args.dry_run,
                formats=formats,
                resume=True,
                backend=args.backend or None,
            )
            for output in outputs:
                print(output)
        return 0
    except NovelTransError as exc:
        print(f"오류: {exc}", file=sys.stderr)
        return 1
    except OSError as exc:
        print(f"파일 오류: {exc}", file=sys.stderr)
        return 1


def _add_rights_confirmation_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--confirm-rights",
        action="store_true",
        help="confirm that you have the right to translate the source text",
    )
    parser.add_argument(
        "--no-redistribute",
        action="store_true",
        help="confirm that generated translations will not be redistributed without permission",
    )


def _assert_usage_confirmed(confirm_rights: bool, no_redistribute: bool) -> None:
    if confirm_rights and no_redistribute:
        return
    raise PolicyViolation(
        "비대화형 실행에는 --confirm-rights 와 --no-redistribute 확인이 모두 필요합니다."
    )


def _export_project(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Regenerate exports for an existing project.")
    parser.add_argument("--project", required=True, help="project slug or project path")
    parser.add_argument("--base-dir", default="projects")
    parser.add_argument("--formats", default="txt,docx,epub")
    args = parser.parse_args(argv)
    try:
        project = ProjectManager(args.base_dir).get_project(args.project)
        formats = [item.strip() for item in args.formats.split(",") if item.strip()]
        outputs = Exporter().export(project, formats=formats)
        print(project.root)
        for output in outputs:
            print(output)
        return 0
    except NovelTransError as exc:
        print(f"오류: {exc}", file=sys.stderr)
        return 1
    except OSError as exc:
        print(f"파일 오류: {exc}", file=sys.stderr)
        return 1


def _status_project(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Show status for an existing project.")
    parser.add_argument("--project", required=True, help="project slug or project path")
    parser.add_argument("--base-dir", default="projects")
    args = parser.parse_args(argv)
    try:
        project = ProjectManager(args.base_dir).get_project(args.project)
        manifest = project.load_manifest()
        print(project.root)
        print(f"project={manifest.name}")
        _print_project_status(project)
        return 0
    except NovelTransError as exc:
        print(f"오류: {exc}", file=sys.stderr)
        return 1
    except OSError as exc:
        print(f"파일 오류: {exc}", file=sys.stderr)
        return 1


def _estimate_project(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Estimate pending project translation tokens and cost.")
    parser.add_argument("--project", required=True, help="project slug or project path")
    parser.add_argument("--base-dir", default="projects")
    parser.add_argument("--all", action="store_true", help="estimate all source episodes, including completed ones")
    args = parser.parse_args(argv)
    try:
        project = ProjectManager(args.base_dir).get_project(args.project)
        estimate = estimate_project_translation(project, resume=not args.all)
        print(project.root)
        print(f"episode_count={estimate.episode_count}")
        print(f"source_chars={estimate.source_chars}")
        print(f"estimated_input_tokens={estimate.estimated_input_tokens}")
        print(f"estimated_output_tokens={estimate.estimated_output_tokens}")
        print(f"estimated_total_tokens={estimate.estimated_total_tokens}")
        print(f"model={estimate.model}")
        if estimate.estimated_cost is None:
            print("estimated_cost=unknown")
        else:
            print(f"estimated_cost={estimate.estimated_cost:.6f}")
        print(f"currency={estimate.currency}")
        print(f"pricing_note={estimate.pricing_note}")
        return 0
    except NovelTransError as exc:
        print(f"오류: {exc}", file=sys.stderr)
        return 1
    except OSError as exc:
        print(f"파일 오류: {exc}", file=sys.stderr)
        return 1


def _report_project(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Print a project's generated quality report.")
    parser.add_argument("--project", required=True, help="project slug or project path")
    parser.add_argument("--base-dir", default="projects")
    parser.add_argument("--json", action="store_true", help="print logs/quality_report.json instead of text")
    args = parser.parse_args(argv)
    try:
        project = ProjectManager(args.base_dir).get_project(args.project)
        path = project.logs_dir / ("quality_report.json" if args.json else "quality_report.txt")
        if not path.exists():
            raise NovelTransError(f"품질 리포트가 없습니다: {path}")
        print(path.read_text(encoding="utf-8").rstrip())
        return 0
    except NovelTransError as exc:
        print(f"오류: {exc}", file=sys.stderr)
        return 1
    except OSError as exc:
        print(f"파일 오류: {exc}", file=sys.stderr)
        return 1


def _verify_project(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Verify project translations, exports, logs, and DB status.")
    parser.add_argument("--project", required=True, help="project slug or project path")
    parser.add_argument("--base-dir", default="projects")
    parser.add_argument("--formats", default="", help="optional comma-separated export formats to verify")
    args = parser.parse_args(argv)
    try:
        project = ProjectManager(args.base_dir).get_project(args.project)
        formats = [item.strip() for item in args.formats.split(",") if item.strip()] or None
        report = verify_project(project, formats=formats)
        print(project.root)
        print(f"ok={str(report.ok).lower()}")
        for item in report.checked:
            print(f"checked={item}")
        for issue in report.issues:
            print(f"issue={issue}")
        return 0 if report.ok else 1
    except NovelTransError as exc:
        print(f"오류: {exc}", file=sys.stderr)
        return 1
    except OSError as exc:
        print(f"파일 오류: {exc}", file=sys.stderr)
        return 1


def _auth(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Manage NovelTrans OpenAI credentials.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    status_parser = subparsers.add_parser("status", help="show whether credentials are configured")
    status_parser.add_argument("--config-dir", default="")

    set_key_parser = subparsers.add_parser("set-api-key", help="store an OpenAI API key")
    set_key_parser.add_argument("--config-dir", default="")
    set_key_parser.add_argument("--from-stdin", action="store_true")

    login_parser = subparsers.add_parser("login", help="open OpenAI API key settings and store a key")
    login_parser.add_argument("--config-dir", default="")
    login_parser.add_argument("--from-stdin", action="store_true")
    login_parser.add_argument("--no-browser", action="store_true")

    set_token_parser = subparsers.add_parser("set-access-token", help="store an OAuth/Bearer access token")
    set_token_parser.add_argument("--config-dir", default="")
    set_token_parser.add_argument("--from-stdin", action="store_true")

    clear_key_parser = subparsers.add_parser("clear-api-key", help="remove the stored API key")
    clear_key_parser.add_argument("--config-dir", default="")

    clear_token_parser = subparsers.add_parser("clear-access-token", help="remove the stored access token")
    clear_token_parser.add_argument("--config-dir", default="")

    codex_status_parser = subparsers.add_parser("codex-status", help="show Codex CLI authentication status")
    codex_status_parser.add_argument("--command", dest="codex_command", default="codex")

    codex_login_parser = subparsers.add_parser("codex-login", help="run `codex login` for ChatGPT OAuth")
    codex_login_parser.add_argument("--command", dest="codex_command", default="codex")
    codex_login_parser.add_argument("--device-auth", action="store_true")

    args = parser.parse_args(argv)
    try:
        raw_config_dir = getattr(args, "config_dir", "")
        config_dir = Path(raw_config_dir).expanduser() if raw_config_dir else None
        store = CredentialStore(config_dir)
        if args.command == "status":
            print(f"api_key={'set' if store.get_api_key() else 'missing'}")
            print(f"access_token={'set' if store.get_access_token() else 'missing'}")
            return 0
        if args.command == "set-api-key":
            secret = _read_secret("OpenAI API key", from_stdin=args.from_stdin)
            backend = store.set_api_key(secret)
            print(f"api_key={backend}")
            return 0
        if args.command == "login":
            _open_auth_page(open_browser=not args.no_browser)
            secret = _read_secret("OpenAI API key", from_stdin=args.from_stdin)
            backend = store.set_api_key(secret)
            print(f"api_key={backend}")
            return 0
        if args.command == "set-access-token":
            secret = _read_secret("OpenAI access token", from_stdin=args.from_stdin)
            backend = store.set_access_token(secret)
            print(f"access_token={backend}")
            return 0
        if args.command == "clear-api-key":
            store.clear_api_key()
            print("api_key=cleared")
            return 0
        if args.command == "clear-access-token":
            store.clear_access_token()
            print("access_token=cleared")
            return 0
        if args.command == "codex-status":
            codex = CodexCLI(command=args.codex_command)
            authenticated, detail = codex.login_status()
            print(f"codex_cli={'installed' if codex.is_installed() else 'missing'}")
            print(f"codex_login={'authenticated' if authenticated else 'missing'}")
            if detail:
                print(f"detail={detail}")
            return 0 if authenticated else 1
        if args.command == "codex-login":
            codex = CodexCLI(command=args.codex_command)
            ok, detail = codex.login(device_auth=args.device_auth)
            print(f"codex_login={'authenticated' if ok else 'failed'}")
            print(f"detail={detail}")
            return 0 if ok else 1
        return 1
    except NovelTransError as exc:
        print(f"오류: {exc}", file=sys.stderr)
        return 1
    except OSError as exc:
        print(f"파일 오류: {exc}", file=sys.stderr)
        return 1


def _policy(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Manage NovelTrans site collection policies.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    import_parser = subparsers.add_parser("import", help="import policy updates from a JSON file or HTTPS URL")
    import_parser.add_argument("--config-dir", default="")
    import_parser.add_argument("--save-url", action="store_true", help="remember --url for later policy refresh")
    source_group = import_parser.add_mutually_exclusive_group(required=True)
    source_group.add_argument("--file", default="")
    source_group.add_argument("--url", default="")

    refresh_parser = subparsers.add_parser("refresh", help="import policies from the configured HTTPS update URL")
    refresh_parser.add_argument("--config-dir", default="")
    refresh_parser.add_argument("--url", default="", help="override and remember this HTTPS update URL")

    show_parser = subparsers.add_parser("show", help="show effective built-in and plugin connector policies")
    show_parser.add_argument("--config-dir", default="")
    show_parser.add_argument("--site", default="", help="filter by site name substring")
    show_parser.add_argument("--no-plugins", action="store_true", help="only show built-in connector policies")

    args = parser.parse_args(argv)
    try:
        registry = _policy_registry_for_config_dir(args.config_dir)
        if args.command == "import":
            if args.file:
                count = registry.import_file(Path(args.file).expanduser())
            else:
                count = registry.import_url(args.url)
                if args.save_url:
                    config_manager = _config_manager_for_config_dir(args.config_dir)
                    config = config_manager.load()
                    config.policy_update_url = args.url
                    config_manager.save(config)
            print(f"imported={count}")
            return 0
        if args.command == "refresh":
            config_manager = _config_manager_for_config_dir(args.config_dir)
            config = config_manager.load()
            if args.url:
                config.policy_update_url = args.url
                config_manager.save(config)
            if not config.policy_update_url.strip():
                raise ConfigurationError("정책 업데이트 URL이 설정되어 있지 않습니다.")
            count = registry.import_url(config.policy_update_url)
            print(f"refreshed={count}")
            print(f"url={config.policy_update_url}")
            return 0
        if args.command == "show":
            engine = PolicyEngine(registry)
            filter_text = args.site.strip().lower()
            for connector in get_connectors(include_plugins=not args.no_plugins):
                policy = engine.effective_policy(connector.get_policy())
                if filter_text and filter_text not in policy.site_name.lower():
                    continue
                status = "auto_fetch=allowed" if policy.auto_fetch_allowed else "auto_fetch=blocked"
                print(f"{policy.site_name}\tgrade={policy.grade}\t{status}\t{policy.notes}")
            return 0
        return 1
    except NovelTransError as exc:
        print(f"오류: {exc}", file=sys.stderr)
        return 1
    except OSError as exc:
        print(f"파일 오류: {exc}", file=sys.stderr)
        return 1


def _policy_registry_for_config_dir(config_dir: str) -> PolicyRegistry:
    if config_dir:
        return PolicyRegistry(Path(config_dir).expanduser() / "policies.json")
    return PolicyRegistry()


def _config_manager_for_config_dir(config_dir: str) -> ConfigManager:
    if config_dir:
        return ConfigManager(Path(config_dir).expanduser())
    return ConfigManager()


def _doctor(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Check NovelTrans runtime configuration.")
    parser.add_argument("--config-dir", default="")
    parser.add_argument("--base-dir", default="")
    parser.add_argument("--backend", default="", help="override default backend for this check")
    parser.add_argument("--strict", action="store_true", help="return non-zero when real translation prerequisites are missing")
    args = parser.parse_args(argv)
    try:
        config_manager = ConfigManager(Path(args.config_dir).expanduser() if args.config_dir else None)
        config = config_manager.load()
        if args.base_dir:
            config.base_dir = args.base_dir
        if args.backend:
            config.default_translation_backend = normalize_translation_backend(args.backend)
        store = CredentialStore(config_manager.config_dir)
        registry = PolicyRegistry(config_manager.config_dir / "policies.json")
        connectors = get_connectors(include_plugins=True)
        policies = [PolicyEngine(registry).effective_policy(connector.get_policy()) for connector in connectors]
        has_api_key = bool(store.get_api_key())
        has_access_token = bool(store.get_access_token())
        credential_mode = "api_key" if has_api_key else "access_token" if has_access_token else "missing"
        codex = CodexCLI(command=config.codex_command, timeout=config.codex_timeout_seconds)
        codex_authenticated, codex_detail = codex.login_status()
        default_backend = normalize_translation_backend(config.default_translation_backend)

        print("NovelTrans doctor")
        print(f"version={__version__}")
        print(f"python={platform.python_version()}")
        print(f"config_dir={config_manager.config_dir}")
        print(f"base_dir={Path(config.base_dir).expanduser()}")
        print(f"default_model={config.default_model}")
        print(f"default_translation_backend={default_backend}")
        print(f"default_parallel_episodes={config.default_parallel_episodes}")
        print(f"credentials={credential_mode}")
        print(f"codex_cli={'installed' if codex.is_installed() else 'missing'}")
        print(f"codex_login={'authenticated' if codex_authenticated else 'missing'}")
        if codex_detail:
            print(f"codex_detail={codex_detail}")
        print(f"connectors={len(connectors)}")
        for policy in policies:
            status = "allowed" if policy.auto_fetch_allowed else "blocked"
            print(f"- {policy.site_name}: grade={policy.grade}, auto_fetch={status}")
        strict_failures: list[str] = []
        if default_backend == "openai" and credential_mode == "missing":
            print("warning=real translation requires OPENAI_API_KEY or a stored access token for OpenAI backend")
            strict_failures.append("credentials_missing")
        elif default_backend == "codex" and not codex_authenticated:
            print("warning=real translation requires Codex CLI login for Codex backend")
            strict_failures.append("codex_login_missing")
        elif default_backend == "auto" and credential_mode == "missing" and not codex_authenticated:
            print("warning=real translation requires OPENAI_API_KEY, a stored access token, or Codex CLI login")
            strict_failures.append("credentials_missing")
        elif default_backend == "dry-run":
            strict_failures.append("real_translation_backend_missing")
        if not any(policy.auto_fetch_allowed for policy in policies):
            print("warning=no connector currently allows automatic body fetch")
            strict_failures.append("no_auto_fetch_connectors")
        if args.strict and strict_failures:
            for failure in strict_failures:
                print(f"strict_failure={failure}")
            return 1
        return 0
    except NovelTransError as exc:
        print(f"오류: {exc}", file=sys.stderr)
        return 1
    except OSError as exc:
        print(f"파일 오류: {exc}", file=sys.stderr)
        return 1


def _read_secret(prompt: str, from_stdin: bool = False) -> str:
    if from_stdin:
        return sys.stdin.readline().strip()
    return getpass.getpass(f"{prompt}: ").strip()


def _open_auth_page(open_browser: bool = True) -> None:
    url = "https://platform.openai.com/settings/organization/api-keys"
    print(f"OpenAI API key 페이지: {url}")
    if open_browser:
        try:
            if not webbrowser.open(url):
                print("브라우저를 자동으로 열지 못했습니다. 위 URL을 직접 여세요.")
        except Exception:
            print("브라우저를 자동으로 열지 못했습니다. 위 URL을 직접 여세요.")


def _validate_parallel_arg(value: int) -> None:
    if not 1 <= value <= 8:
        raise ConfigurationError("동시 번역 화수는 1부터 8 사이여야 합니다.")


def _ask_choice(
    title: str,
    choices: list[tuple[str, str, str]],
    default: str,
    help_text: str = "",
) -> str:
    print(f"\n{title}")
    if help_text:
        print(help_text)
    default_index = 1
    for index, (label, value, hint) in enumerate(choices, start=1):
        if value == default:
            default_index = index
        suffix = " (기본)" if value == default else ""
        detail = f" - {hint}" if hint else ""
        print(f"{index}. {label}{suffix}{detail}")
    while True:
        raw = _ask("선택", str(default_index))
        try:
            index = int(raw)
        except ValueError:
            print("숫자를 입력하세요.")
            continue
        if 1 <= index <= len(choices):
            return choices[index - 1][1]
        print("목록에 있는 번호를 입력하세요.")


def _ask_multi_choice(
    title: str,
    choices: list[tuple[str, str, str]],
    defaults: list[str],
) -> list[str]:
    print(f"\n{title}")
    default_numbers: list[str] = []
    for index, (label, value, hint) in enumerate(choices, start=1):
        if value in defaults:
            default_numbers.append(str(index))
        detail = f" - {hint}" if hint else ""
        marker = "*" if value in defaults else " "
        print(f"{index}. [{marker}] {label}{detail}")
    while True:
        raw = _ask("선택 번호를 쉼표로 입력", ",".join(default_numbers))
        try:
            numbers = [int(part.strip()) for part in raw.split(",") if part.strip()]
        except ValueError:
            print("숫자와 쉼표만 입력하세요.")
            continue
        if numbers and all(1 <= number <= len(choices) for number in numbers):
            selected: list[str] = []
            for number in numbers:
                value = choices[number - 1][1]
                if value not in selected:
                    selected.append(value)
            return selected
        print("하나 이상, 목록에 있는 번호를 입력하세요.")


def _choose_episode_spec(title: str) -> str:
    mode = _ask_choice(
        title,
        [
            ("전체 화", "all", "프로젝트가 가진 모든 화"),
            ("한 화만", "single", "예: 12"),
            ("연속 범위", "range", "예: 1-10"),
            ("몇 개만 골라서", "list", "예: 1,3,8,12"),
            ("최신 N화", "latest", "예: 최신 5"),
            ("직접 입력", "custom", "all, 1-10, 5,8,12-20 같은 형식"),
        ],
        "all",
        help_text="화수 입력 형식을 외우지 않아도 됩니다. 아래에서 고르세요.",
    )
    if mode == "all":
        return "all"
    if mode == "single":
        return str(_ask_int("화 번호", 1, 1, 99999))
    if mode == "range":
        start = _ask_int("시작 화", 1, 1, 99999)
        end = _ask_int("끝 화", start, start, 99999)
        return f"{start}-{end}"
    if mode == "list":
        print("쉼표로 구분합니다. 예: 1,3,5")
        return _ask("가져올 화 번호 목록", "1,3,5")
    if mode == "latest":
        count = _ask_choice(
            "최신 몇 화",
            [
                ("최신 1화", "1", ""),
                ("최신 3화", "3", ""),
                ("최신 5화", "5", ""),
                ("최신 10화", "10", ""),
                ("직접 입력", "custom", ""),
            ],
            "5",
        )
        if count == "custom":
            count = str(_ask_int("최신 화 수", 5, 1, 999))
        return f"최신 {count}"
    print("사용 가능한 예시: all / 1-10 / 5,8,12-20 / 최신 5")
    return _ask("화수 범위 직접 입력", "all")


def _choose_model(default: str, title: str = "모델") -> str:
    configured = default.strip() or "gpt-5.5"
    choices = [(f"현재 기본값 사용 ({configured})", configured, "모델명을 모르겠으면 이 값을 사용")]
    if configured != "gpt-5.5":
        choices.append(("gpt-5.5", "gpt-5.5", "프로젝트 기본 추천값"))
    choices.append(("직접 입력", "__custom__", "새 모델이나 호환 엔드포인트를 알고 있을 때"))
    selected = _ask_choice(title, choices, configured, help_text="모델명을 모르겠으면 현재 기본값을 사용하세요.")
    if selected == "__custom__":
        return _ask("모델명 직접 입력", configured)
    return selected


def _choose_concurrency(default: int) -> int:
    default_value = str(default) if default in {1, 2, 4, 8} else "4"
    selected = _ask_choice(
        "동시 번역 화수",
        [
            ("1화", "1", "가장 안정적"),
            ("2화", "2", "저속/저부하"),
            ("4화", "4", "기본 추천"),
            ("8화", "8", "빠르지만 실패/비용 관리 필요"),
            ("직접 입력", "custom", "1-8 사이"),
        ],
        default_value,
    )
    if selected == "custom":
        return _ask_int("동시 번역 화수", default, 1, 8)
    return int(selected)


def _choose_formats() -> list[str]:
    return _ask_multi_choice(
        "출력 형식",
        [
            ("TXT", "txt", "가장 단순한 텍스트 출력"),
            ("DOCX", "docx", "워드/문서 편집용"),
            ("EPUB", "epub", "전자책 리더용"),
        ],
        ["txt", "docx", "epub"],
    )


def _choose_reasoning_effort(default: str) -> str:
    return _ask_choice(
        "추론 강도",
        [
            ("낮음", "low", "빠른 초벌 번역"),
            ("보통", "medium", "균형 추천"),
            ("높음", "high", "비용/시간보다 품질 우선"),
        ],
        default if default in {"low", "medium", "high"} else "medium",
    )


def _choose_style(default: str) -> str:
    return _select_or_custom(
        "문체 프로필",
        [
            ("한국 웹소설 균형체", "korean_webnovel_balanced", "기본 추천"),
            ("문학적 자연화", "korean_webnovel_literary_naturalized", "문장을 더 자연스럽게 다듬음"),
            ("직역 구조 보존", "literal_structure_preserving", "원문 순서와 표현을 더 보존"),
            ("용어 일관성 우선", "korean_webnovel_term_consistency_first", "고유명사와 설정 표기 고정"),
        ],
        default,
        "잘 모르겠으면 한국 웹소설 균형체를 고르세요.",
    )


def _choose_honorific_policy(default: str) -> str:
    return _select_or_custom(
        "존댓말/호칭 정책",
        [
            ("상황 맞춤", "adaptive", "기본 추천"),
            ("원문 격식 보존", "preserve_formality", "존댓말/반말 차이를 더 엄격히 유지"),
            ("한국어 자연화", "korean_natural", "일본식 호칭을 줄이고 자연스럽게 처리"),
            ("원문 호칭 우선", "source_suffix_sensitive", "님/씨/짱/군 같은 호칭 차이를 더 보존"),
        ],
        default,
        "캐릭터 말투와 호칭을 처리하는 정책입니다.",
    )


def _choose_glossary_strictness(default: str) -> str:
    return _ask_choice(
        "용어집 엄격도",
        [
            ("낮음", "low", "문맥상 자연스러우면 변형 허용"),
            ("보통", "medium", "핵심 고유명사 중심"),
            ("높음", "high", "기본 추천"),
            ("매우 엄격", "strict", "스킬명/지명/인명 흔들림 최소화"),
        ],
        default if default in {"low", "medium", "high", "strict"} else "high",
    )


def _choose_temperature(default: float | None) -> float | None:
    current = 0.3 if default is None else default
    selected = _ask_choice(
        "문장 변형 정도",
        [
            ("낮음 0.1", "0.1", "용어/표현 일관성 우선"),
            ("균형 0.3", "0.3", "기본 추천"),
            ("자연화 0.45", "0.45", "문장 다듬기 여지 확대"),
            ("높음 0.6", "0.6", "창의적 재구성 증가"),
            ("직접 입력", "custom", f"현재값: {current}"),
        ],
        str(current) if current in {0.1, 0.3, 0.45, 0.6} else "0.3",
        help_text="값이 높을수록 표현 변화가 커질 수 있습니다.",
    )
    if selected == "custom":
        return _ask_float("temperature 직접 입력", current, minimum=0.0)
    return float(selected)


def _choose_long_episode_threshold(default: int) -> int:
    selected = _ask_choice(
        "긴 화 기준 글자 수",
        [
            ("10,000자", "10000", "자주 분할"),
            ("20,000자", "20000", "기본 추천"),
            ("40,000자", "40000", "긴 화만 분할"),
            ("직접 입력", "custom", f"현재값: {default}"),
        ],
        str(default) if default in {10000, 20000, 40000} else "20000",
    )
    if selected == "custom":
        return _ask_int("긴 화 기준 글자 수 직접 입력", default, 1000, 200000)
    return int(selected)


def _choose_term_type() -> str:
    return _select_or_custom(
        "용어 유형",
        [
            ("인명", "person", ""),
            ("지명", "place", ""),
            ("조직명", "organization", ""),
            ("기술/스킬명", "skill", ""),
            ("칭호", "title", ""),
            ("고유 표현", "proper_noun", "확실하지 않을 때 추천"),
            ("말투", "speech_style", ""),
            ("설명/묘사", "description", ""),
        ],
        "proper_noun",
        "용어집의 분류값입니다.",
    )


def _select_or_custom(
    title: str,
    choices: list[tuple[str, str, str]],
    default: str,
    help_text: str,
) -> str:
    values = {value for _, value, _ in choices}
    selected = _ask_choice(
        title,
        [*choices, ("직접 입력", "__custom__", f"현재값: {default}")],
        default if default in values else "__custom__",
        help_text=help_text,
    )
    if selected == "__custom__":
        return _ask(f"{title} 직접 입력", default)
    return selected


def _ask(prompt: str, default: str = "") -> str:
    suffix = f" [{default}]" if default else ""
    value = input(f"{prompt}{suffix}: ").strip()
    return value or default


def _ask_int(prompt: str, default: int, minimum: int, maximum: int) -> int:
    while True:
        raw = _ask(prompt, str(default))
        try:
            value = int(raw)
        except ValueError:
            print("숫자를 입력하세요.")
            continue
        if minimum <= value <= maximum:
            return value
        print(f"{minimum}부터 {maximum} 사이 값을 입력하세요.")


def _ask_float(prompt: str, default: float, minimum: float = 0.0) -> float:
    while True:
        raw = _ask(prompt, str(default))
        try:
            value = float(raw)
        except ValueError:
            print("숫자를 입력하세요.")
            continue
        if value >= minimum:
            return value
        print(f"{minimum} 이상의 값을 입력하세요.")


def _confirm(prompt: str, default: bool = True) -> bool:
    default_text = "Y/n" if default else "y/N"
    raw = input(f"{prompt} ({default_text}): ").strip().lower()
    if not raw:
        return default
    return raw in {"y", "yes", "예", "ㅇ", "true", "1"}


if __name__ == "__main__":
    raise SystemExit(main())
