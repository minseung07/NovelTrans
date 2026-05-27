"""Hermes-style terminal wizard for NovelTrans."""

from __future__ import annotations

import os
import shutil
import shlex
import subprocess
import sys
import tempfile
import textwrap
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from . import __version__
from .config import AppConfig, ConfigManager, CredentialStore
from .connectors import detect_connector
from .errors import NovelTransError, PolicyViolation
from .exporters import Exporter
from .glossary import GlossaryManager
from .models import ExportOptions, GlossaryEntry, ParallelOptions, QualityOptions, TranslationOptions
from .policy import SAFE_POLICY_TEXT, PolicyEngine
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

try:
    import termios
    import tty
except ImportError:  # pragma: no cover - Windows fallback path.
    termios = None  # type: ignore[assignment]
    tty = None  # type: ignore[assignment]


@dataclass(frozen=True, slots=True)
class Choice:
    label: str
    value: str
    hint: str = ""


class TerminalPrompt:
    """Small dependency-free selector for keyboard-driven terminal flows."""

    def __init__(self) -> None:
        self.interactive = bool(sys.stdin.isatty() and sys.stdout.isatty() and termios and tty)
        self.color = bool(sys.stdout.isatty() and os.environ.get("NO_COLOR") is None)

    def _width(self) -> int:
        return max(68, min(shutil.get_terminal_size((96, 24)).columns, 118))

    def _paint(self, value: str, code: str) -> str:
        if not self.color:
            return value
        return f"\033[{code}m{value}\033[0m"

    def _bold(self, value: str) -> str:
        return self._paint(value, "1")

    def _dim(self, value: str) -> str:
        return self._paint(value, "2")

    def _muted(self, value: str) -> str:
        return self._paint(value, "38;5;245")

    def _accent(self, value: str) -> str:
        return self._paint(value, "38;5;81")

    def _success(self, value: str) -> str:
        return self._paint(value, "38;5;114")

    def _warning(self, value: str) -> str:
        return self._paint(value, "38;5;221")

    def _danger(self, value: str) -> str:
        return self._paint(value, "38;5;203")

    def select(
        self,
        title: str,
        choices: Iterable[Choice],
        default: str | None = None,
        body: str | Iterable[str] | None = None,
    ) -> str:
        options = list(choices)
        if not options:
            raise NovelTransError("선택할 항목이 없습니다.")
        index = _default_index(options, default)
        if not self.interactive:
            return self._select_numbered(title, options, index, body)
        while True:
            self._draw_select(title, options, index, body)
            key = _read_key()
            if key in {"up", "left", "k"}:
                index = (index - 1) % len(options)
            elif key in {"down", "right", "j"}:
                index = (index + 1) % len(options)
            elif key.isdigit() and key != "0" and int(key) <= len(options):
                index = int(key) - 1
            elif key == "enter":
                self.clear()
                return options[index].value
            elif key in {"q", "esc"}:
                raise KeyboardInterrupt

    def multiselect(
        self,
        title: str,
        choices: Iterable[Choice],
        defaults: Iterable[str] | None = None,
        allow_empty: bool = False,
        body: str | Iterable[str] | None = None,
    ) -> list[str]:
        options = list(choices)
        if not options:
            raise NovelTransError("선택할 항목이 없습니다.")
        selected = set(defaults or [])
        index = 0
        if not self.interactive:
            return self._multiselect_numbered(title, options, selected, allow_empty, body)
        while True:
            self._draw_multiselect(title, options, index, selected, allow_empty, body)
            key = _read_key()
            if key in {"up", "left", "k"}:
                index = (index - 1) % len(options)
            elif key in {"down", "right", "j"}:
                index = (index + 1) % len(options)
            elif key == "space":
                value = options[index].value
                if value in selected:
                    selected.remove(value)
                else:
                    selected.add(value)
            elif key == "a":
                if len(selected) == len(options):
                    selected.clear()
                else:
                    selected = {choice.value for choice in options}
            elif key.isdigit() and key != "0" and int(key) <= len(options):
                value = options[int(key) - 1].value
                if value in selected:
                    selected.remove(value)
                else:
                    selected.add(value)
            elif key == "enter":
                if selected or allow_empty:
                    self.clear()
                    return [choice.value for choice in options if choice.value in selected]
            elif key in {"q", "esc"}:
                raise KeyboardInterrupt

    def confirm(self, title: str, default: bool = True, body: str | Iterable[str] | None = None) -> bool:
        value = self.select(
            title,
            [
                Choice("예", "yes", "동의하고 계속합니다."),
                Choice("아니오", "no", "이 작업을 취소합니다."),
            ],
            default="yes" if default else "no",
            body=body,
        )
        return value == "yes"

    def input(self, title: str, default: str = "", required: bool = False) -> str:
        while True:
            if self.interactive:
                self.clear()
                self._draw_header(title)
                if default:
                    print(f"  {self._muted('default')} {default}")
                print()
                prompt = f"  {self._accent('›')} "
            else:
                suffix = f" [{default}]" if default else ""
                prompt = f"{title}{suffix}: "
            value = input(prompt).strip() or default
            if value or not required:
                return value
            print(self._danger("값을 입력해야 합니다."))

    def integer(self, title: str, default: int, minimum: int, maximum: int) -> int:
        while True:
            raw = self.input(title, str(default), required=True)
            try:
                value = int(raw)
            except ValueError:
                print(self._danger("숫자를 입력하세요."))
                continue
            if minimum <= value <= maximum:
                return value
            print(self._danger(f"{minimum}부터 {maximum} 사이 값을 입력하세요."))

    def pause(self) -> None:
        if self.interactive:
            input(f"\n{self._muted('Enter')} 계속")

    def clear(self) -> None:
        if self.interactive:
            print("\033[2J\033[H", end="")

    def banner(self, subtitle: str = "", detail: str = "") -> None:
        self._draw_header(subtitle, detail)

    def panel(self, title: str, body: str | Iterable[str]) -> None:
        print(f"  {self._muted('╭─')} {self._bold(title)}")
        for line in self._format_body(body):
            print(f"  {self._muted('│')} {line}")
        print(f"  {self._muted('╰')}")
        print()

    def result(self, title: str, lines: Iterable[str], ok: bool = True) -> None:
        self.clear()
        marker = self._success("✓") if ok else self._danger("!")
        self._draw_header(f"{marker} {title}")
        for line in lines:
            print(f"  {line}")
        print()

    def _select_numbered(
        self,
        title: str,
        options: list[Choice],
        index: int,
        body: str | Iterable[str] | None = None,
    ) -> str:
        print(f"\n{title}")
        self._print_body(body)
        for number, choice in enumerate(options, start=1):
            marker = " (기본)" if number - 1 == index else ""
            hint = f" - {choice.hint}" if choice.hint else ""
            print(f"{number}. {choice.label}{marker}{hint}")
        while True:
            raw = input("선택: ").strip()
            if not raw:
                return options[index].value
            try:
                number = int(raw)
            except ValueError:
                print("숫자를 입력하세요.")
                continue
            if 1 <= number <= len(options):
                return options[number - 1].value
            print("목록에 있는 번호를 입력하세요.")

    def _multiselect_numbered(
        self,
        title: str,
        options: list[Choice],
        selected: set[str],
        allow_empty: bool,
        body: str | Iterable[str] | None = None,
    ) -> list[str]:
        print(f"\n{title}")
        self._print_body(body)
        for number, choice in enumerate(options, start=1):
            checked = "*" if choice.value in selected else " "
            hint = f" - {choice.hint}" if choice.hint else ""
            print(f"{number}. [{checked}] {choice.label}{hint}")
        while True:
            raw = input("선택 번호를 쉼표로 입력: ").strip()
            if not raw and selected:
                return [choice.value for choice in options if choice.value in selected]
            if not raw and allow_empty:
                return []
            try:
                numbers = {int(part.strip()) for part in raw.split(",") if part.strip()}
            except ValueError:
                print("숫자와 쉼표만 입력하세요.")
                continue
            if all(1 <= number <= len(options) for number in numbers):
                values = [options[number - 1].value for number in sorted(numbers)]
                if values or allow_empty:
                    return values
            print("목록에 있는 번호를 입력하세요.")

    def _draw_select(
        self,
        title: str,
        options: list[Choice],
        index: int,
        body: str | Iterable[str] | None = None,
    ) -> None:
        self.clear()
        self._draw_header(title)
        self._print_body(body)
        for option_index, choice in enumerate(options):
            cursor = self._accent("›") if option_index == index else " "
            number = self._muted(f"{option_index + 1}.")
            label = self._bold(choice.label) if option_index == index else choice.label
            hint = f" {self._muted('·')} {self._muted(choice.hint)}" if choice.hint else ""
            if option_index == index:
                print(f"  {cursor} {number} {self._accent(label)}{hint}")
            else:
                print(f"    {number} {label}{hint}")
        self._footer("↑/↓ 또는 j/k 이동", "Enter 선택", "q 취소")

    def _draw_multiselect(
        self,
        title: str,
        options: list[Choice],
        index: int,
        selected: set[str],
        allow_empty: bool,
        body: str | Iterable[str] | None = None,
    ) -> None:
        self.clear()
        self._draw_header(title)
        self._print_body(body)
        if not allow_empty:
            print(f"  {self._warning('하나 이상 선택해야 합니다.')}")
            print()
        for option_index, choice in enumerate(options):
            cursor = self._accent("›") if option_index == index else " "
            checked = self._success("●") if choice.value in selected else self._muted("○")
            number = self._muted(f"{option_index + 1}.")
            label = self._bold(choice.label) if option_index == index else choice.label
            hint = f" {self._muted('·')} {self._muted(choice.hint)}" if choice.hint else ""
            line = f"{cursor} {number} {checked} {label}"
            if option_index == index:
                print(f"  {self._accent(line)}{hint}")
            else:
                print(f"  {line}{hint}")
        self._footer("↑/↓ 또는 j/k 이동", "Space 토글", "a 전체", "Enter 확정", "q 취소")

    def _draw_header(self, title: str = "", detail: str = "") -> None:
        width = self._width()
        brand = f"{self._bold('NovelTrans')} {self._muted(__version__)}"
        tagline = self._muted("authorized translation workspace")
        print(f"{brand}  {tagline}")
        print(self._muted("─" * width))
        if title:
            print(f"{self._accent('▸')} {self._bold(title)}")
        if detail:
            print(f"  {self._muted(detail)}")
        print()

    def _footer(self, *items: str) -> None:
        print()
        print("  " + self._muted("   ".join(items)))

    def _format_body(self, body: str | Iterable[str]) -> list[str]:
        raw_items = body.splitlines() if isinstance(body, str) else list(body)
        width = max(48, self._width() - 6)
        lines: list[str] = []
        for item in raw_items:
            split_lines = str(item).splitlines() or [""]
            for raw in split_lines:
                if not raw:
                    lines.append("")
                    continue
                wrapped = textwrap.wrap(raw, width=width, replace_whitespace=False, drop_whitespace=False)
                lines.extend(wrapped or [""])
        return lines

    def _print_body(self, body: str | Iterable[str] | None) -> None:
        if not body:
            return
        for line in self._format_body(body):
            print(f"  {self._muted('│')} {line}" if line else f"  {self._muted('│')}")
        print()


def wizard_main() -> int:
    prompt = TerminalPrompt()
    config_manager = ConfigManager()
    config = config_manager.load()
    manager = ProjectManager(config.base_dir)
    prompt.clear()

    while True:
        action = prompt.select(
            "무엇을 할까요?",
            [
                Choice("새 번역 프로젝트 만들기", "new", "URL 또는 사용자가 제공한 파일에서 시작"),
                Choice("기존 프로젝트 이어서 번역", "resume", "상태 확인, 원문 추가, 미완료 번역"),
                Choice("용어집 관리", "glossary", "용어 추가, 잠금, 충돌 해결"),
                Choice("출력 파일 다시 생성", "export", "txt/docx/epub 재생성"),
                Choice("설정", "settings", "모델, 백엔드, 저장 위치, 인증"),
                Choice("종료", "quit"),
            ],
            default="new",
            body=[
                "권한이 있는 원문만 가져오고, 사이트 정책 게이트를 통과하지 못한 본문 자동 수집은 막습니다.",
                f"프로젝트 저장소: {manager.base_dir}",
                f"기본 백엔드: {config.default_translation_backend}   모델: {config.default_model}",
            ],
        )
        try:
            if action == "new":
                _new_project_wizard(prompt, manager, config)
            elif action == "resume":
                _resume_project_wizard(prompt, manager)
            elif action == "glossary":
                _glossary_wizard(prompt, manager)
            elif action == "export":
                _export_wizard(prompt, manager)
            elif action == "settings":
                config = _settings_wizard(prompt, config_manager, config)
                manager = ProjectManager(config.base_dir)
            elif action == "quit":
                return 0
        except NovelTransError as exc:
            prompt.result("오류", [str(exc)], ok=False)
            prompt.pause()
        except OSError as exc:
            prompt.result("파일 오류", [str(exc)], ok=False)
            prompt.pause()


def _new_project_wizard(prompt: TerminalPrompt, manager: ProjectManager, config: AppConfig) -> None:
    prompt.clear()
    if not prompt.confirm("나는 이 텍스트를 번역할 권한이 있다", default=False, body=SAFE_POLICY_TEXT):
        raise PolicyViolation("권한 확인이 필요합니다.")
    if not prompt.confirm("결과물을 무단 배포하지 않는다", default=False):
        raise PolicyViolation("재배포 금지 확인이 필요합니다.")

    name = prompt.input("프로젝트 이름", "my_novel", required=True)
    source_mode = prompt.select(
        "원본 입력 방식",
        [
            Choice("URL 입력", "url"),
            Choice("TXT/HTML/ZIP 파일 불러오기", "file"),
            Choice("클립보드/붙여넣기", "clipboard"),
            Choice("터미널에서 직접 입력", "manual"),
            Choice("외부 편집기로 작성", "editor"),
        ],
        default="file",
    )
    episode_spec = prompt.input("번역할 화수 범위", "all")
    translation, parallel, quality, export = _collect_translation_options(prompt, config)

    if source_mode == "url":
        project = _create_project_from_url_wizard(
            prompt,
            manager,
            name,
            translation,
            parallel,
            quality,
            export,
            episode_spec,
        )
    else:
        input_path = _source_file_from_mode(prompt, source_mode)
        project = create_project_from_local_file(
            manager=manager,
            name=name,
            input_path=input_path,
            translation=translation,
            parallel=parallel,
            quality=quality,
            export=export,
            episode_spec=episode_spec,
        )

    _run_project_translation(prompt, project, translation.backend, resume=False)


def _create_project_from_url_wizard(
    prompt: TerminalPrompt,
    manager: ProjectManager,
    name: str,
    translation: TranslationOptions,
    parallel: ParallelOptions,
    quality: QualityOptions,
    export: ExportOptions,
    episode_spec: str,
) -> Project:
    url = prompt.input("소설 URL", required=True)
    connector = detect_connector(url)
    policy_engine = PolicyEngine()
    policy = policy_engine.effective_policy(connector.get_policy())
    prompt.clear()
    prompt.banner("사이트 감지")
    prompt.panel("정책 게이트", policy_engine.describe(policy))

    fallback_file = None
    allow_auto_fetch = False
    permission_note = ""
    if policy.auto_fetch_allowed:
        allow_auto_fetch = prompt.confirm("이 URL의 자동 수집 조건을 충족하며 처리 권한이 있다", default=False)
        if allow_auto_fetch or policy.requires_user_permission:
            permission_note = prompt.input("권한/라이선스 근거 메모", "user confirmed authorized personal use")
    else:
        prompt.panel("자동 수집 차단", "이 사이트는 자동 본문 수집이 꺼져 있습니다. 사용자가 제공한 원문만 처리합니다.")
        prompt.pause()
        fallback_file = _collect_user_source_file_wizard(prompt)

    return create_project_from_url(
        manager=manager,
        name=name,
        url=url,
        translation=translation,
        parallel=parallel,
        quality=quality,
        export=export,
        episode_spec=episode_spec,
        user_permission=allow_auto_fetch,
        permission_evidence=permission_note,
        fallback_file=fallback_file,
    )


def _resume_project_wizard(prompt: TerminalPrompt, manager: ProjectManager) -> None:
    project = _select_project_wizard(prompt, manager)
    while True:
        prompt.clear()
        manifest = project.load_manifest()
        action = prompt.select(
            "작업 선택",
            [
                Choice("미완료/실패 화 번역", "translate"),
                Choice("새 원문 파일 가져오기", "add"),
                Choice("새 원문 가져오고 번역", "add_translate"),
                Choice("검증 실행", "verify"),
                Choice("품질 리포트 보기", "report"),
                Choice("메인으로", "back"),
            ],
            default="translate",
            body=[f"프로젝트: {manifest.name}", str(project.root), "", _project_status_text(project)],
        )
        if action == "back":
            return
        if action in {"add", "add_translate"}:
            _add_source_to_project_wizard(prompt, project)
            if action == "add":
                prompt.pause()
                continue
        if action in {"translate", "add_translate"}:
            backend = _choose_backend_wizard(prompt, manifest.translation.backend, with_project_default=True)
            _run_project_translation(prompt, project, backend or None, resume=True)
            return
        if action == "verify":
            prompt.result("검증 결과", _verification_lines(project))
            prompt.pause()
        if action == "report":
            prompt.result("품질 리포트", _quality_report_lines(project))
            prompt.pause()


def _add_source_to_project_wizard(prompt: TerminalPrompt, project: Project) -> None:
    source_mode = prompt.select(
        "추가할 원문 입력 방식",
        [
            Choice("TXT/HTML/ZIP 파일", "file"),
            Choice("클립보드/붙여넣기", "clipboard"),
            Choice("터미널에서 직접 입력", "manual"),
            Choice("외부 편집기로 작성", "editor"),
        ],
        default="file",
    )
    input_path = _source_file_from_mode(prompt, source_mode)
    episode_spec = prompt.input("가져올 화수 범위", "all")
    replace_existing = prompt.confirm("기존 화 번호도 새 원문으로 교체할까요", default=False)
    imported = add_source_episodes_from_local_file(
        project=project,
        input_path=input_path,
        episode_spec=episode_spec,
        replace_existing=replace_existing,
    )
    prompt.result("원문 가져오기 완료", ["가져온 화: " + (", ".join(str(number) for number in imported) if imported else "없음")])


def _glossary_wizard(prompt: TerminalPrompt, manager: ProjectManager) -> None:
    project = _select_project_wizard(prompt, manager)
    glossary = GlossaryManager(project.glossary_dir)
    while True:
        prompt.clear()
        manifest = project.load_manifest()
        action = prompt.select(
            "용어집 작업",
            [
                Choice("용어 추가/수정", "save"),
                Choice("용어 잠금", "lock"),
                Choice("충돌 보기/해결", "conflict"),
                Choice("메인으로", "back"),
            ],
            default="save",
            body=[f"프로젝트: {manifest.name}", "", *_glossary_snapshot_lines(glossary)],
        )
        if action == "back":
            return
        if action == "save":
            source = prompt.input("원문 용어", required=True)
            target = prompt.input("한국어 번역", source, required=True)
            term_type = prompt.input("유형", "proper_noun")
            locked = prompt.confirm("잠금", default=True)
            glossary.add_or_update(
                GlossaryEntry(
                    source=source,
                    target=target,
                    type=term_type,
                    confidence=1.0,
                    locked=locked,
                    notes="user provided",
                )
            )
            _sync_glossary_to_project_db(project, glossary)
            prompt.result("저장 완료", [f"{source} -> {target}"])
            prompt.pause()
        elif action == "lock":
            source = prompt.input("잠글 원문 용어", required=True)
            locked = glossary.lock_term(source)
            prompt.result("잠금 완료" if locked else "용어 없음", [source], ok=locked)
            _sync_glossary_to_project_db(project, glossary)
            prompt.pause()
        elif action == "conflict":
            _resolve_conflict_wizard(prompt, project, glossary)


def _export_wizard(prompt: TerminalPrompt, manager: ProjectManager) -> None:
    project = _select_project_wizard(prompt, manager)
    formats = _choose_formats(prompt)
    outputs = Exporter().export(project, formats=formats)
    prompt.result("출력 파일 생성 완료", [f"출력: {output}" for output in outputs])
    prompt.pause()


def _settings_wizard(prompt: TerminalPrompt, config_manager: ConfigManager, config: AppConfig) -> AppConfig:
    store = CredentialStore(config_manager.config_dir)
    while True:
        prompt.clear()
        action = prompt.select(
            "변경할 항목",
            [
                Choice("프로젝트 기본 디렉터리", "base_dir"),
                Choice("기본 모델", "model"),
                Choice("기본 번역 백엔드", "backend"),
                Choice("기본 동시 번역 화수", "parallel"),
                Choice("워터마크", "watermark"),
                Choice("OpenAI API key 저장/교체", "api_key"),
                Choice("OpenAI access token 저장/교체", "access_token"),
                Choice("Codex 로그인 상태 확인", "codex_status"),
                Choice("저장하고 메인으로", "back"),
            ],
            default="back",
            body=[
                f"프로젝트 디렉터리: {config.base_dir}",
                f"기본 모델: {config.default_model}",
                f"기본 백엔드: {config.default_translation_backend}",
                f"동시 번역 화수: {config.default_parallel_episodes}",
                f"OpenAI API key: {'설정됨' if store.get_api_key() else '없음'}",
                f"OpenAI access token: {'설정됨' if store.get_access_token() else '없음'}",
            ],
        )
        if action == "back":
            config_manager.save(config)
            return config
        if action == "base_dir":
            config.base_dir = prompt.input("프로젝트 기본 디렉터리", config.base_dir, required=True)
        elif action == "model":
            config.default_model = prompt.input("기본 모델", config.default_model, required=True)
        elif action == "backend":
            config.default_translation_backend = _choose_backend_wizard(prompt, config.default_translation_backend)
        elif action == "parallel":
            config.default_parallel_episodes = prompt.integer("기본 동시 번역 화수", config.default_parallel_episodes, 1, 8)
        elif action == "watermark":
            config.watermark = prompt.input("워터마크", config.watermark)
        elif action == "api_key":
            secret = prompt.input("OpenAI API key", required=True)
            backend = store.set_api_key(secret)
            prompt.result("API key 저장 완료", [f"저장 위치: {backend}"])
            prompt.pause()
        elif action == "access_token":
            secret = prompt.input("OpenAI access token", required=True)
            backend = store.set_access_token(secret)
            prompt.result("access token 저장 완료", [f"저장 위치: {backend}"])
            prompt.pause()
        elif action == "codex_status":
            codex = CodexCLI(command=config.codex_command)
            authenticated, detail = codex.login_status()
            lines = [
                f"codex_cli={'installed' if codex.is_installed() else 'missing'}",
                f"codex_login={'authenticated' if authenticated else 'missing'}",
            ]
            if detail:
                lines.append(detail)
            prompt.result("Codex 로그인 상태", lines, ok=authenticated)
            prompt.pause()
        config_manager.save(config)


def _collect_translation_options(
    prompt: TerminalPrompt,
    config: AppConfig,
) -> tuple[TranslationOptions, ParallelOptions, QualityOptions, ExportOptions]:
    preset = prompt.select(
        "번역 모드",
        [
            Choice("빠른 초벌 번역", "fast", "속도 우선"),
            Choice("균형 번역", "balanced", "일반 추천값"),
            Choice("문학적 자연화", "literary", "한국 웹소설 문체 자연화"),
            Choice("직역 보존", "literal", "원문 구조 최대 보존"),
            Choice("용어 일관성 최우선", "glossary", "고유명사/설정 일관성 강화"),
            Choice("커스텀", "custom", "세부 옵션 직접 지정"),
        ],
        default="balanced",
    )
    backend = _choose_backend_wizard(prompt, config.default_translation_backend)
    model = prompt.input("모델", config.default_model, required=True)
    concurrency = int(
        prompt.select(
            "동시 번역 화수",
            [Choice(str(value), str(value)) for value in (1, 2, 4, 8)],
            default=str(config.default_parallel_episodes if config.default_parallel_episodes in {1, 2, 4, 8} else 4),
        )
    )
    formats = _choose_formats(prompt)
    translation = _translation_options_for_preset(preset, model, config.default_reasoning_effort)
    translation.backend = backend
    parallel = ParallelOptions(max_parallel_episodes=concurrency)
    quality = QualityOptions()
    export = ExportOptions(formats=formats, watermark=config.watermark)
    if preset == "custom":
        _customize_options_wizard(prompt, translation, parallel, quality, export)
    else:
        quality.run_qa_pass = prompt.confirm("QA 패스 실행", default=True)
        quality.run_term_consistency_pass = prompt.confirm("용어 일관성 검사", default=True)
        export.include_author_notes = prompt.confirm("출력에 작가 후기 포함", default=True)
    return translation, parallel, quality, export


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


def _customize_options_wizard(
    prompt: TerminalPrompt,
    translation: TranslationOptions,
    parallel: ParallelOptions,
    quality: QualityOptions,
    export: ExportOptions,
) -> None:
    translation.style = prompt.input("문체 프로필", translation.style, required=True)
    translation.honorific_policy = prompt.input("존댓말/호칭 정책", translation.honorific_policy, required=True)
    translation.preserve_japanese_suffixes = prompt.confirm("일본어 호칭 접미사 보존", translation.preserve_japanese_suffixes)
    translation.translate_author_notes = prompt.confirm("작가 후기 번역", translation.translate_author_notes)
    translation.keep_ruby_as_parentheses = prompt.confirm("루비를 괄호로 보존", translation.keep_ruby_as_parentheses)
    translation.glossary_strictness = prompt.input("용어집 엄격도", translation.glossary_strictness, required=True)
    parallel.split_long_episode = prompt.confirm("긴 화를 내부 분할", parallel.split_long_episode)
    parallel.long_episode_threshold_chars = prompt.integer(
        "긴 화 기준 글자 수",
        parallel.long_episode_threshold_chars,
        1000,
        200000,
    )
    quality.run_qa_pass = prompt.confirm("QA 패스 실행", quality.run_qa_pass)
    quality.run_term_consistency_pass = prompt.confirm("용어 일관성 검사", quality.run_term_consistency_pass)
    quality.check_missing_paragraphs = prompt.confirm("누락 문단 검사", quality.check_missing_paragraphs)
    quality.compare_length_ratio = prompt.confirm("길이 비율 검사", quality.compare_length_ratio)
    banned = prompt.input("금칙어", "")
    quality.banned_terms = [item.strip() for item in banned.split(",") if item.strip()]
    export.include_glossary = prompt.confirm("용어집 부록 포함", export.include_glossary)
    export.include_author_notes = prompt.confirm("출력에 작가 후기 포함", export.include_author_notes)
    export.epub_vertical_writing = prompt.confirm("EPUB 세로쓰기", export.epub_vertical_writing)


def _choose_backend_wizard(prompt: TerminalPrompt, default: str, with_project_default: bool = False) -> str:
    normalized_default = normalize_translation_backend(default) if default else ""
    choices: list[Choice] = []
    if with_project_default:
        choices.append(Choice("프로젝트 기본값", "", normalized_default or "manifest setting"))
    choices.extend(
        [
            Choice("자동 선택", "auto", "OpenAI 자격 증명 우선, 없으면 Codex CLI"),
            Choice("OpenAI API key/access token", "openai"),
            Choice("Codex CLI 로그인", "codex"),
            Choice("Dry-run", "dry-run", "실제 번역 없이 파일 생성 흐름 검증"),
        ]
    )
    return prompt.select("번역 백엔드", choices, default=normalized_default or "auto")


def _choose_formats(prompt: TerminalPrompt) -> list[str]:
    return prompt.multiselect(
        "출력 형식",
        [
            Choice("TXT", "txt"),
            Choice("DOCX", "docx"),
            Choice("EPUB", "epub"),
        ],
        defaults=["txt", "docx", "epub"],
    )


def _run_project_translation(
    prompt: TerminalPrompt,
    project: Project,
    backend: str | None,
    resume: bool,
) -> None:
    manifest = project.load_manifest()
    selected_backend = backend or manifest.translation.backend
    dry_run = _should_use_dry_run(prompt, selected_backend)
    estimate = estimate_project_translation(project, resume=resume)
    summary = [
        f"프로젝트: {project.root}",
        f"대상 화수: {estimate.episode_count}",
        f"예상 토큰: {estimate.estimated_total_tokens}",
        f"백엔드: {'dry-run' if dry_run else selected_backend}",
    ]
    if estimate.estimated_cost is not None:
        summary.insert(3, f"예상 비용: ${estimate.estimated_cost:.4f}")
    if not prompt.confirm("번역을 시작할까요", default=True, body=summary):
        return
    outputs = run_translation_and_export(project, dry_run=dry_run, resume=resume, backend=selected_backend)
    prompt.result("완료", [f"프로젝트: {project.root}", "", *[f"출력: {output}" for output in outputs]])
    prompt.pause()


def _should_use_dry_run(prompt: TerminalPrompt, backend: str) -> bool:
    backend = normalize_translation_backend(backend)
    if backend == "dry-run":
        return True
    if backend == "codex":
        return False
    if backend == "auto" and _has_codex_credentials():
        return False
    if _has_openai_credentials(CredentialStore()):
        return False
    body = ["OpenAI API key 또는 access token이 없습니다."]
    if backend == "auto":
        body.append("Codex CLI 로그인도 확인되지 않았습니다.")
    return prompt.confirm("dry-run으로 진행할까요", default=True, body=body)


def _has_openai_credentials(store: CredentialStore) -> bool:
    return bool(store.get_api_key() or store.get_access_token())


def _has_codex_credentials() -> bool:
    authenticated, _ = CodexCLI().login_status()
    return authenticated


def _source_file_from_mode(prompt: TerminalPrompt, source_mode: str) -> Path:
    if source_mode == "file":
        return Path(prompt.input("TXT/HTML/ZIP 파일 경로", required=True)).expanduser()
    if source_mode == "clipboard":
        return _capture_text_to_temp_file(_read_clipboard_or_paste(), suffix=".txt")
    if source_mode == "manual":
        return _capture_text_to_temp_file(_read_multiline_text(), suffix=".txt")
    if source_mode == "editor":
        return _capture_editor_text_to_temp_file()
    raise NovelTransError("알 수 없는 입력 방식입니다.")


def _collect_user_source_file_wizard(prompt: TerminalPrompt) -> Path:
    mode = prompt.select(
        "원문 제공 방식",
        [
            Choice("TXT/HTML/ZIP 파일 경로", "file"),
            Choice("클립보드/붙여넣기", "clipboard"),
            Choice("터미널에서 직접 입력", "manual"),
            Choice("외부 편집기로 작성", "editor"),
        ],
        default="file",
    )
    return _source_file_from_mode(prompt, mode)


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
    completed = subprocess.run([*shlex.split(editor), str(path)], check=False)
    if completed.returncode != 0:
        raise NovelTransError(f"편집기가 실패했습니다: exit={completed.returncode}")
    if not path.read_text(encoding="utf-8").strip():
        raise NovelTransError("편집기에서 저장한 본문이 비어 있습니다.")
    return path


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


def _select_project_wizard(prompt: TerminalPrompt, manager: ProjectManager) -> Project:
    projects = manager.list_projects()
    if not projects:
        raise NovelTransError("프로젝트가 없습니다.")
    choices: list[Choice] = []
    for index, project in enumerate(projects):
        try:
            manifest = project.load_manifest()
            label = manifest.name
        except Exception:
            label = project.root.name
        choices.append(Choice(label, str(index), str(project.root)))
    selected = int(prompt.select("프로젝트 선택", choices, default="0"))
    return projects[selected]


def _project_status_text(project: Project) -> str:
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
    return "\n".join(
        [
            f"완료: {_format_episode_numbers(completed)}",
            f"실패: {_format_episode_numbers(failed)}",
            f"미번역: {_format_episode_numbers(pending)}",
        ]
    )


def _format_episode_numbers(numbers: list[int]) -> str:
    values = sorted(numbers)
    if not values:
        return "없음"
    ranges: list[str] = []
    start = previous = values[0]
    for number in values[1:]:
        if number == previous + 1:
            previous = number
            continue
        ranges.append(str(start) if start == previous else f"{start}-{previous}")
        start = previous = number
    ranges.append(str(start) if start == previous else f"{start}-{previous}")
    return ", ".join(ranges)


def _sync_glossary_to_project_db(project: Project, glossary: GlossaryManager) -> None:
    for entry in glossary.snapshot(limit=10_000):
        project.db.upsert_glossary_entry(entry.source, entry.target, entry.type, entry.confidence, entry.locked)


def _glossary_snapshot_lines(glossary: GlossaryManager) -> list[str]:
    entries = glossary.snapshot(limit=20)
    lines = ["최근 용어"]
    if not entries:
        lines.append("(비어 있음)")
    for entry in entries:
        locked = "잠금" if entry.locked else "편집"
        lines.append(f"- {entry.source} -> {entry.target} [{entry.type}, {locked}, {entry.confidence:.2f}]")
    conflicts = glossary.conflict_snapshot(limit=5)
    if conflicts:
        lines.append("")
        lines.append("충돌")
        for conflict in conflicts:
            lines.append(f"- {conflict.source}: {conflict.previous} / {conflict.suggested}")
    return lines


def _print_glossary_snapshot(glossary: GlossaryManager) -> None:
    for line in _glossary_snapshot_lines(glossary):
        print(line)
    print()


def _resolve_conflict_wizard(prompt: TerminalPrompt, project: Project, glossary: GlossaryManager) -> None:
    conflicts = glossary.conflict_snapshot(limit=50)
    if not conflicts:
        prompt.result("용어 충돌 없음", ["처리할 충돌이 없습니다."])
        prompt.pause()
        return
    choices = [
        Choice(
            f"{conflict.source}: {conflict.previous} / {conflict.suggested}",
            str(index),
            conflict.recommendation,
        )
        for index, conflict in enumerate(conflicts)
    ]
    selected = conflicts[int(prompt.select("해결할 충돌", choices, default="0"))]
    action = prompt.select(
        "처리 방식",
        [
            Choice("기존 번역 유지", "keep_previous"),
            Choice("새 번역 적용", "use_suggested"),
            Choice("기존 번역 유지하고 잠금", "keep_and_lock"),
        ],
        default="keep_previous",
    )
    if glossary.resolve_conflict(selected.source, action):
        _sync_glossary_to_project_db(project, glossary)
        prompt.result("충돌 해결 완료", [selected.source])
    else:
        prompt.result("충돌 해결 실패", [selected.source], ok=False)
    prompt.pause()


def _verification_lines(project: Project) -> list[str]:
    report = verify_project(project)
    lines = [f"ok={str(report.ok).lower()}"]
    lines.extend(f"checked={item}" for item in report.checked)
    lines.extend(f"issue={issue}" for issue in report.issues)
    return lines


def _print_verification(project: Project) -> None:
    for line in _verification_lines(project):
        print(line)


def _quality_report_lines(project: Project) -> list[str]:
    path = project.logs_dir / "quality_report.txt"
    if not path.exists():
        raise NovelTransError(f"품질 리포트가 없습니다: {path}")
    return path.read_text(encoding="utf-8").rstrip().splitlines()


def _print_quality_report(project: Project) -> None:
    for line in _quality_report_lines(project):
        print(line)


def _default_index(options: list[Choice], default: str | None) -> int:
    for index, option in enumerate(options):
        if option.value == default:
            return index
    return 0


def _read_key() -> str:
    if not termios or not tty:
        return "enter"
    fd = sys.stdin.fileno()
    previous = termios.tcgetattr(fd)
    try:
        tty.setraw(fd)
        char = sys.stdin.read(1)
        if char == "\x03":
            raise KeyboardInterrupt
        if char == "\x1b":
            rest = sys.stdin.read(2)
            if rest == "[A":
                return "up"
            if rest == "[B":
                return "down"
            if rest == "[C":
                return "right"
            if rest == "[D":
                return "left"
            return "esc"
        if char in {"\r", "\n"}:
            return "enter"
        if char == " ":
            return "space"
        if char.lower() == "q":
            return "q"
        return char
    finally:
        termios.tcsetattr(fd, termios.TCSADRAIN, previous)
