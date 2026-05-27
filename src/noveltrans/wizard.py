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
from threading import Thread
from time import monotonic
from typing import Callable, Iterable

from . import __version__
from .config import AppConfig, ConfigManager, CredentialStore
from .connectors import detect_connector
from .errors import NovelTransError, PolicyViolation
from .exporters import Exporter
from .glossary import GlossaryManager
from .models import ExportOptions, GlossaryEntry, ParallelOptions, QualityOptions, TranslationOptions
from .policy import SAFE_POLICY_TEXT, PolicyEngine
from .progress import format_progress_lines, snapshot_project_progress, target_episode_numbers
from .project import Project, ProjectManager
from .status import format_episode_numbers, project_status
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


class BackRequested(Exception):
    """Raised when the user asks to return to the previous screen."""


@dataclass(slots=True)
class NewProjectDraft:
    name: str
    source_mode: str
    url: str
    input_path: Path | None
    fallback_file: Path | None
    episode_spec: str
    translation: TranslationOptions
    parallel: ParallelOptions
    quality: QualityOptions
    export: ExportOptions
    allow_auto_fetch: bool
    permission_note: str
    policy_summary: str


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
            elif key in {"b", "back"}:
                self.clear()
                raise BackRequested
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
            elif key in {"b", "back"}:
                self.clear()
                raise BackRequested
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

    def input(
        self,
        title: str,
        default: str = "",
        required: bool = False,
        body: str | Iterable[str] | None = None,
    ) -> str:
        while True:
            if self.interactive:
                self.clear()
                self._draw_header(title)
                self._print_body(body)
                if default:
                    print(f"  {self._muted('기본값')} {default}")
                print(f"  {self._muted(':back')} {self._muted('이전 화면')}")
                print()
                prompt = f"  {self._accent('›')} "
            else:
                self._print_body(body)
                suffix = f" [{default}]" if default else ""
                prompt = f"{title}{suffix} (:back=뒤로): "
            value = input(prompt).strip() or default
            if value in {":back", ":뒤로"}:
                raise BackRequested
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
            input(f"\n{self._muted('엔터')} 계속")

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
            if raw.lower() in {"b", "back"} or raw == "뒤로":
                raise BackRequested
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
            if raw.lower() in {"b", "back"} or raw == "뒤로":
                raise BackRequested
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
        self._footer("↑/↓ 또는 j/k 이동", "엔터 선택", "b back", "q 취소")

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
        self._footer("↑/↓ 또는 j/k 이동", "스페이스 토글", "a 전체", "엔터 확정", "b back", "q 취소")

    def _draw_header(self, title: str = "", detail: str = "") -> None:
        width = self._width()
        brand = f"{self._bold('NovelTrans')} {self._muted(__version__)}"
        tagline = self._muted("권한 확인 번역 작업 공간")
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


def _backend_label(value: str | None) -> str:
    labels = {
        "auto": "자동 선택",
        "openai": "OpenAI로 번역",
        "codex": "Codex로 번역",
        "dry-run": "Dry-run",
        "": "프로젝트 기본값",
    }
    try:
        normalized = normalize_translation_backend(value or "auto") if value else ""
    except NovelTransError:
        return f"직접 입력값: {value}"
    return labels.get(normalized, f"직접 입력값: {value}")


def _source_mode_label(value: str | None) -> str:
    labels = {
        "url": "URL 붙여넣기",
        "file": "파일 선택",
        "clipboard": "클립보드 붙여넣기",
        "manual": "직접 입력",
        "editor": "편집기로 작성",
    }
    return labels.get(value or "", f"직접 입력값: {value}")


def _url_mode_label(value: str | None) -> str:
    labels = {
        "auto": "정책 허용 시 자동 수집",
        "user-file": "사용자 제공 본문 우선",
        "ask": "매번 선택",
    }
    return labels.get(value or "", f"직접 입력값: {value}")


def _preset_label(value: str | None) -> str:
    labels = {
        "fast": "빠른 초벌 번역",
        "balanced": "균형 번역",
        "literary": "문학적 자연화",
        "literal": "직역 보존",
        "glossary": "용어 일관성 우선",
    }
    return labels.get(value or "", f"직접 입력값: {value}")


def _reasoning_label(value: str | None) -> str:
    labels = {"low": "낮음", "medium": "보통", "high": "높음"}
    return labels.get(value or "", f"직접 입력값: {value}")


def _glossary_strictness_label(value: str | None) -> str:
    labels = {"low": "낮음", "medium": "보통", "high": "높음", "strict": "매우 엄격"}
    return labels.get(value or "", f"직접 입력값: {value}")


def _style_label(value: str | None) -> str:
    labels = {
        "korean_webnovel_balanced": "한국 웹소설 균형체",
        "korean_webnovel_literary_naturalized": "문학적 자연화",
        "literal_structure_preserving": "직역 구조 보존",
        "korean_webnovel_term_consistency_first": "용어 일관성 우선",
    }
    return labels.get(value or "", f"직접 입력값: {value}")


def _honorific_label(value: str | None) -> str:
    labels = {
        "adaptive": "상황 맞춤",
        "preserve_formality": "원문 격식 보존",
        "korean_natural": "한국어 자연화",
        "source_suffix_sensitive": "원문 호칭 우선",
    }
    return labels.get(value or "", f"직접 입력값: {value}")


def _format_label(value: str) -> str:
    labels = {"txt": "TXT", "epub": "EPUB"}
    return labels.get(value, f"직접 입력값: {value}")


def _formats_label(values: Iterable[str]) -> str:
    return ", ".join(_format_label(value) for value in values)


def _enabled_label(value: bool) -> str:
    return "사용" if value else "사용 안 함"


def _included_label(value: bool) -> str:
    return "포함" if value else "제외"


def _episode_spec_label(value: str) -> str:
    return "전체" if value == "all" else value


def _parallel_label(value: int) -> str:
    labels = {
        1: "차분하게 1화씩",
        2: "보통 2화씩",
        4: "빠르게 4화씩",
        8: "최대 8화씩",
    }
    return labels.get(value, f"동시 {value}화")


def wizard_main() -> int:
    prompt = TerminalPrompt()
    config_manager = ConfigManager()
    config = config_manager.load()
    manager = ProjectManager(config.base_dir)
    prompt.clear()

    while True:
        try:
            projects = manager.list_projects()
            choices = [
                Choice("새 원문 번역", "new", "원문을 넣고 바로 번역 준비"),
            ]
            if projects:
                choices.append(Choice("이어서 번역", "project", "미완료/실패 화 이어서 처리"))
            choices.extend(
                [
                    Choice("결과 파일 다시 만들기", "export", "기존 프로젝트의 TXT/EPUB 재생성"),
                    Choice("도구와 설정", "tools", "기본값, 인증, 용어집"),
                    Choice("종료", "quit"),
                ]
            )
            action = prompt.select(
                "NovelTrans",
                choices,
                default="new",
                body=_home_body_lines(manager, config, projects),
            )
            if action == "new":
                _new_project_wizard(prompt, manager, config)
            elif action == "project":
                _resume_project_wizard(prompt, manager)
            elif action == "export":
                _export_wizard(prompt, manager)
            elif action == "tools":
                config = _tools_and_settings_wizard(prompt, manager, config_manager, config)
                manager = ProjectManager(config.base_dir)
            elif action == "quit":
                return 0
        except BackRequested:
            prompt.clear()
        except NovelTransError as exc:
            prompt.result("오류", [str(exc)], ok=False)
            prompt.pause()
        except OSError as exc:
            prompt.result("파일 오류", [str(exc)], ok=False)
            prompt.pause()


def _home_body_lines(manager: ProjectManager, config: AppConfig, projects: list[Project]) -> list[str]:
    lines = [
        "권한이 있는 원문만 처리합니다.",
        "",
        "최근 작업",
    ]
    if not projects:
        lines.append("- 아직 프로젝트가 없습니다.")
        return lines
    for project in projects[:5]:
        try:
            manifest = project.load_manifest()
            status = project_status(project)
            counts = status.counts
            lines.append(
                f"- {manifest.name}: 완료 {counts['completed']}화, 미번역 {counts['pending']}화, 실패 {counts['failed']}화"
            )
        except Exception:
            lines.append(f"- {project.root.name}: 상태를 읽지 못했습니다.")
    return lines


def _tools_and_settings_wizard(
    prompt: TerminalPrompt,
    manager: ProjectManager,
    config_manager: ConfigManager,
    config: AppConfig,
) -> AppConfig:
    while True:
        action = prompt.select(
            "도구와 설정",
            [
                Choice("설정", "settings", "인증, 번역 기본값, 출력 기본값"),
                Choice("용어집 관리", "glossary", "프로젝트별 용어 추가, 잠금, 충돌 해결"),
                Choice("메인으로", "back"),
            ],
            default="settings",
            body=[
                f"프로젝트 저장소: {manager.base_dir}",
                f"기본 번역: {_preset_label(config.default_translation_preset)}",
                f"결과 파일: {_formats_label(config.default_output_formats)}",
            ],
        )
        if action == "back":
            return config
        if action == "settings":
            config = _settings_wizard(prompt, config_manager, config)
            manager = ProjectManager(config.base_dir)
        elif action == "glossary":
            _glossary_wizard(prompt, manager)


def _new_project_wizard(prompt: TerminalPrompt, manager: ProjectManager, config: AppConfig) -> None:
    draft = _new_project_draft_from_config(config)
    while True:
        try:
            if not _draft_has_source(draft) and not _collect_initial_project_source(prompt, draft, config):
                return
            action = prompt.select(
                "번역 준비 완료",
                [
                    Choice("번역 시작", "start", "현재 준비 내용으로 바로 진행"),
                    Choice("바꾸기", "change", "원본, 범위, 결과 파일, 번역 모드"),
                    Choice("고급 설정", "advanced", "모델, 인증 방식, 검토 세부 항목"),
                    Choice("메인으로", "back"),
                ],
                default="start",
                body=_new_project_summary_lines(draft),
            )
            if action == "back":
                return
            if action == "change":
                _edit_new_project_basics(prompt, draft, config)
            elif action == "advanced":
                _customize_new_project_defaults(prompt, draft, config)
            elif action == "start":
                if not _confirm_new_project_rights(prompt, draft):
                    continue
                project = _create_project_from_draft(manager, draft)
                _run_project_translation(prompt, project, draft.translation.backend, resume=False, confirm_start=False)
                return
        except BackRequested:
            continue


def _draft_has_source(draft: NewProjectDraft) -> bool:
    if draft.source_mode == "url":
        return bool(draft.url and (draft.allow_auto_fetch or draft.fallback_file))
    return draft.input_path is not None


def _collect_initial_project_source(prompt: TerminalPrompt, draft: NewProjectDraft, config: AppConfig) -> bool:
    try:
        source_mode = _choose_source_mode_for_new_project(
            prompt,
            "원문을 넣어주세요",
            draft.source_mode,
            back_label="메인으로",
            body=[
                "URL은 정책상 허용된 경우에만 본문을 가져옵니다.",
                "자동 수집이 막힌 사이트는 사용자가 제공한 파일이나 붙여넣기로 진행합니다.",
            ],
        )
        if source_mode == "back":
            return False
        draft.source_mode = source_mode
        _collect_new_project_source(prompt, draft, config)
    except BackRequested:
        return False
    return _draft_has_source(draft)


def _choose_source_mode_for_new_project(
    prompt: TerminalPrompt,
    title: str,
    default: str,
    back_label: str,
    body: str | Iterable[str] | None = None,
) -> str:
    return prompt.select(
        title,
        [*_source_mode_choices(), Choice(back_label, "back")],
        default=default if default in {"url", "file", "clipboard", "manual", "editor"} else "url",
        body=body,
    )


def _edit_draft_source(prompt: TerminalPrompt, draft: NewProjectDraft, config: AppConfig) -> None:
    source_mode = _choose_source_mode_for_new_project(
        prompt,
        "원본 바꾸기",
        draft.source_mode,
        back_label="준비 화면으로",
        body=[
            "자동 수집이 불가한 사이트는 URL을 작품 식별용으로만 저장하고 본문은 사용자가 제공한 파일을 받습니다.",
            "번역 권한 확인은 시작 직전에 한 번만 묻습니다.",
        ],
    )
    if source_mode == "back":
        return
    draft.source_mode = source_mode
    _collect_new_project_source(prompt, draft, config)


def _edit_new_project_basics(prompt: TerminalPrompt, draft: NewProjectDraft, config: AppConfig) -> None:
    while True:
        action = prompt.select(
            "바꾸기",
            [
                Choice("원본", "source", _source_mode_label(draft.source_mode)),
                Choice("프로젝트 이름", "name", draft.name),
                Choice("번역 범위", "episodes", _episode_spec_label(draft.episode_spec)),
                Choice("결과 파일", "formats", _formats_label(draft.export.formats)),
                Choice("번역 모드", "preset", _preset_label(draft.translation.preset)),
                Choice("속도", "parallel", _parallel_label(draft.parallel.max_parallel_episodes)),
                Choice("준비 화면으로", "back"),
            ],
            default="back",
            body=_new_project_summary_lines(draft),
        )
        if action == "back":
            return
        if action == "source":
            _edit_draft_source(prompt, draft, config)
        elif action == "name":
            draft.name = prompt.input(
                "프로젝트 이름",
                draft.name,
                required=True,
                body="폴더 이름으로도 쓰입니다. 짧고 구분되는 이름이 관리하기 쉽습니다.",
            )
        elif action == "episodes":
            draft.episode_spec = _choose_episode_spec_wizard(prompt, "번역 범위")
        elif action == "formats":
            draft.export.formats = _choose_formats(prompt, defaults=draft.export.formats)
        elif action == "preset":
            preset = prompt.select(
                "번역 모드",
                _translation_preset_choices(),
                default=draft.translation.preset,
            )
            _apply_translation_preset_to_options(draft.translation, preset, reset_reasoning=True)
        elif action == "parallel":
            draft.parallel.max_parallel_episodes = _choose_parallel_episodes_wizard(
                prompt,
                draft.parallel.max_parallel_episodes,
            )


def _draft_quality_hint(draft: NewProjectDraft) -> str:
    return (
        f"품질 검사 {_enabled_label(draft.quality.run_qa_pass)}, "
        f"용어 검사 {_enabled_label(draft.quality.run_term_consistency_pass)}"
    )


def _customize_new_project_quality(prompt: TerminalPrompt, draft: NewProjectDraft) -> None:
    while True:
        action = prompt.select(
            "검토 강도",
            [
                Choice("번역 품질 검사", "qa", _enabled_label(draft.quality.run_qa_pass)),
                Choice("이름/용어 흔들림 검사", "terms", _enabled_label(draft.quality.run_term_consistency_pass)),
                Choice("누락 문단 검사", "missing", _enabled_label(draft.quality.check_missing_paragraphs)),
                Choice("길이 비율 검사", "ratio", _enabled_label(draft.quality.compare_length_ratio)),
                Choice("작가 후기 출력", "author_notes", _included_label(draft.export.include_author_notes)),
                Choice("긴 화 내부 분할", "split", _enabled_label(draft.parallel.split_long_episode)),
                Choice("고급 설정으로", "back"),
            ],
            default="back",
            body=_new_project_summary_lines(draft),
        )
        if action == "back":
            return
        if action == "qa":
            draft.quality.run_qa_pass = prompt.confirm("번역 품질 검사를 실행할까요", draft.quality.run_qa_pass)
        elif action == "terms":
            draft.quality.run_term_consistency_pass = prompt.confirm(
                "이름/용어 흔들림 검사를 실행할까요",
                draft.quality.run_term_consistency_pass,
            )
        elif action == "missing":
            draft.quality.check_missing_paragraphs = prompt.confirm("누락 문단을 검사할까요", draft.quality.check_missing_paragraphs)
        elif action == "ratio":
            draft.quality.compare_length_ratio = prompt.confirm("원문과 번역문 길이 비율을 검사할까요", draft.quality.compare_length_ratio)
        elif action == "author_notes":
            draft.export.include_author_notes = prompt.confirm("출력에 작가 후기를 포함할까요", draft.export.include_author_notes)
        elif action == "split":
            draft.parallel.split_long_episode = prompt.confirm("긴 화를 내부 분할할까요", draft.parallel.split_long_episode)
            if draft.parallel.split_long_episode:
                draft.parallel.long_episode_threshold_chars = _choose_long_episode_threshold_wizard(
                    prompt,
                    draft.parallel.long_episode_threshold_chars,
                )


def _new_project_draft_from_config(config: AppConfig) -> NewProjectDraft:
    return NewProjectDraft(
        name="my_novel",
        source_mode=config.default_source_mode,
        url="",
        input_path=None,
        fallback_file=None,
        episode_spec=config.default_episode_spec,
        translation=_translation_options_from_config(config),
        parallel=_parallel_options_from_config(config),
        quality=_quality_options_from_config(config),
        export=_export_options_from_config(config),
        allow_auto_fetch=False,
        permission_note="",
        policy_summary="",
    )


def _translation_options_from_config(config: AppConfig) -> TranslationOptions:
    options = _translation_options_for_preset(
        config.default_translation_preset,
        config.default_model,
        config.default_reasoning_effort,
    )
    baseline = AppConfig()
    options.backend = config.default_translation_backend
    if config.default_reasoning_effort != baseline.default_reasoning_effort:
        options.reasoning_effort = config.default_reasoning_effort
    if config.default_style != baseline.default_style:
        options.style = config.default_style
    options.honorific_policy = config.default_honorific_policy
    options.preserve_japanese_suffixes = config.default_preserve_japanese_suffixes
    options.translate_author_notes = config.default_translate_author_notes
    options.keep_ruby_as_parentheses = config.default_keep_ruby_as_parentheses
    if config.default_glossary_strictness != baseline.default_glossary_strictness:
        options.glossary_strictness = config.default_glossary_strictness
    if config.default_temperature != baseline.default_temperature:
        options.temperature = config.default_temperature
    return options


def _parallel_options_from_config(config: AppConfig) -> ParallelOptions:
    return ParallelOptions(
        max_parallel_episodes=config.default_parallel_episodes,
        split_long_episode=config.default_split_long_episode,
        long_episode_threshold_chars=config.default_long_episode_threshold_chars,
    )


def _quality_options_from_config(config: AppConfig) -> QualityOptions:
    return QualityOptions(
        run_qa_pass=config.default_run_qa_pass,
        run_term_consistency_pass=config.default_run_term_consistency_pass,
        check_missing_paragraphs=config.default_check_missing_paragraphs,
        compare_length_ratio=config.default_compare_length_ratio,
        banned_terms=list(config.default_banned_terms),
    )


def _export_options_from_config(config: AppConfig) -> ExportOptions:
    return ExportOptions(
        formats=list(config.default_output_formats),
        include_glossary=config.default_include_glossary,
        include_author_notes=config.default_include_author_notes,
        watermark=config.watermark,
        epub_vertical_writing=config.default_epub_vertical_writing,
    )


def _collect_new_project_source(prompt: TerminalPrompt, draft: NewProjectDraft, config: AppConfig) -> None:
    draft.input_path = None
    draft.fallback_file = None
    draft.policy_summary = ""
    draft.allow_auto_fetch = False
    draft.permission_note = ""
    if draft.source_mode == "url":
        draft.url = prompt.input("소설 URL", draft.url, required=True)
        connector = detect_connector(draft.url)
        policy_engine = PolicyEngine()
        policy = policy_engine.effective_policy(connector.get_policy())
        draft.policy_summary = policy_engine.describe(policy)
        if config.show_policy_details_on_start:
            prompt.clear()
            prompt.banner("사이트 감지", policy.site_name)
            prompt.panel("정책 게이트", draft.policy_summary)
        if policy.auto_fetch_allowed:
            action = config.default_url_collection_mode
            if action == "ask":
                action = prompt.select(
                    "URL 처리 방식",
                    [
                        Choice("정책에 맞으면 자동 수집", "auto", "정책 조건과 권한 근거를 남기고 진행"),
                        Choice("사용자 제공 본문 사용", "user-file", "직접 저장한 파일이나 붙여넣기"),
                        Choice("원본 입력 다시 선택", "back"),
                    ],
                    default="auto" if policy.grade == "A" else "user-file",
                    body=[
                        "이 선택은 설정에서 기본값으로 바꿀 수 있습니다.",
                        "확실하지 않으면 사용자 제공 본문 방식을 선택하세요.",
                    ],
                )
                if action == "back":
                    raise BackRequested
            if action == "user_file":
                action = "user-file"
            if action == "user-file":
                draft.fallback_file = _collect_user_source_file_wizard(prompt)
                return
            draft.allow_auto_fetch = True
            draft.permission_note = config.default_permission_note
            return
        if config.show_policy_details_on_start:
            prompt.panel(
                "자동 수집 차단",
                [
                    "이 사이트는 URL에서 본문을 자동으로 가져오지 않습니다.",
                    "URL은 작품 식별/메타데이터 보존용으로만 쓰고, 본문은 사용자가 직접 제공한 파일이나 붙여넣기를 사용합니다.",
                ],
            )
        draft.fallback_file = _collect_user_source_file_wizard(prompt)
        return
    draft.input_path = _source_file_from_mode(prompt, draft.source_mode)


def _new_project_summary_lines(draft: NewProjectDraft) -> list[str]:
    source = draft.url if draft.source_mode == "url" else str(draft.input_path or "")
    if draft.source_mode == "url" and draft.fallback_file:
        source = f"{draft.url}\n사용자 제공 본문: {draft.fallback_file}"
    lines = [
        f"프로젝트: {draft.name}",
        f"원본: {source or '(아직 없음)'}",
        f"분량: {_episode_spec_label(draft.episode_spec)}",
        f"결과 파일: {_formats_label(draft.export.formats)}",
        f"번역: {_preset_label(draft.translation.preset)}",
        f"속도: {_parallel_label(draft.parallel.max_parallel_episodes)}",
        f"검토: {_review_summary_label(draft)}",
    ]
    policy_lines = _policy_status_lines(draft)
    if policy_lines:
        lines.extend(["", *policy_lines])
    return lines


def _review_summary_label(draft: NewProjectDraft) -> str:
    checks: list[str] = []
    if draft.quality.run_qa_pass:
        checks.append("품질")
    if draft.quality.run_term_consistency_pass:
        checks.append("용어")
    if not checks:
        return "꺼짐"
    return ", ".join(checks)


def _policy_status_lines(draft: NewProjectDraft) -> list[str]:
    if draft.source_mode != "url" or not draft.policy_summary:
        return []
    if draft.allow_auto_fetch:
        return ["URL 원문 가져오기: 허용됨"]
    if draft.fallback_file:
        return ["URL 원문 가져오기: 차단됨", "본문: 사용자 제공 원문 사용"]
    return ["URL 원문 가져오기: 확인 필요"]


def _customize_new_project_defaults(prompt: TerminalPrompt, draft: NewProjectDraft, config: AppConfig) -> None:
    while True:
        action = prompt.select(
            "고급 설정",
            [
                Choice("번역 방식", "backend", _backend_label(draft.translation.backend)),
                Choice("모델", "model", draft.translation.model),
                Choice("문체/호칭", "translation_detail", _translation_detail_hint(draft.translation)),
                Choice("검토 강도", "quality", _draft_quality_hint(draft)),
                Choice("결과 파일 세부", "output", "용어집/작가 후기/EPUB"),
                Choice("준비 화면으로", "back"),
            ],
            default="back",
            body=_new_project_summary_lines(draft),
        )
        if action == "back":
            return
        if action == "backend":
            draft.translation.backend = _choose_backend_wizard(prompt, draft.translation.backend)
        elif action == "model":
            draft.translation.model = _choose_model_wizard(prompt, draft.translation.model)
        elif action == "translation_detail":
            _customize_new_project_translation_detail(prompt, draft)
        elif action == "quality":
            _customize_new_project_quality(prompt, draft)
        elif action == "output":
            _customize_new_project_output(prompt, draft)


def _translation_detail_hint(translation: TranslationOptions) -> str:
    return f"{_style_label(translation.style)}, {_honorific_label(translation.honorific_policy)}"


def _customize_new_project_translation_detail(prompt: TerminalPrompt, draft: NewProjectDraft) -> None:
    while True:
        action = prompt.select(
            "문체/호칭",
            [
                Choice("추론 강도", "reasoning", _reasoning_label(draft.translation.reasoning_effort)),
                Choice("문체", "style", _style_label(draft.translation.style)),
                Choice("존댓말/호칭", "honorific", _honorific_label(draft.translation.honorific_policy)),
                Choice("용어집 엄격도", "glossary", _glossary_strictness_label(draft.translation.glossary_strictness)),
                Choice("문장 변형 정도", "temperature", str(draft.translation.temperature)),
                Choice("일본어 호칭 접미사 보존", "suffixes", _enabled_label(draft.translation.preserve_japanese_suffixes)),
                Choice("작가 후기 번역", "translate_notes", _enabled_label(draft.translation.translate_author_notes)),
                Choice("루비 괄호 보존", "ruby", _enabled_label(draft.translation.keep_ruby_as_parentheses)),
                Choice("고급 설정으로", "back"),
            ],
            default="back",
            body=_new_project_summary_lines(draft),
        )
        if action == "back":
            return
        _edit_translation_option(prompt, draft.translation, action)


def _customize_new_project_output(prompt: TerminalPrompt, draft: NewProjectDraft) -> None:
    while True:
        action = prompt.select(
            "결과 파일 세부",
            [
                Choice("용어집 부록", "glossary", _included_label(draft.export.include_glossary)),
                Choice("작가 후기 출력", "author_notes", _included_label(draft.export.include_author_notes)),
                Choice("EPUB 세로쓰기", "vertical", _enabled_label(draft.export.epub_vertical_writing)),
                Choice("준비 화면으로", "back"),
            ],
            default="back",
            body=_new_project_summary_lines(draft),
        )
        if action == "back":
            return
        if action == "glossary":
            draft.export.include_glossary = prompt.confirm("용어집 부록을 포함할까요", draft.export.include_glossary)
        elif action == "author_notes":
            draft.export.include_author_notes = prompt.confirm("작가 후기를 결과 파일에 포함할까요", draft.export.include_author_notes)
        elif action == "vertical":
            draft.export.epub_vertical_writing = prompt.confirm("EPUB 세로쓰기를 사용할까요", draft.export.epub_vertical_writing)


def _confirm_new_project_rights(prompt: TerminalPrompt, draft: NewProjectDraft) -> bool:
    body = [
        SAFE_POLICY_TEXT,
        "",
        "계속하면 아래 두 가지를 확인한 것으로 기록합니다.",
        "- 나는 이 원문을 번역할 권한이 있다.",
        "- 결과물을 권한 없이 재배포하지 않는다.",
    ]
    if draft.policy_summary:
        body.extend(["", "사이트 정책", draft.policy_summary])
    return prompt.confirm("권한과 재배포 금지를 확인하고 시작할까요", default=True, body=body)


def _create_project_from_draft(manager: ProjectManager, draft: NewProjectDraft) -> Project:
    if draft.source_mode == "url":
        return create_project_from_url(
            manager=manager,
            name=draft.name,
            url=draft.url,
            translation=draft.translation,
            parallel=draft.parallel,
            quality=draft.quality,
            export=draft.export,
            episode_spec=draft.episode_spec,
            user_permission=draft.allow_auto_fetch,
            permission_evidence=draft.permission_note,
            fallback_file=draft.fallback_file,
        )
    if draft.input_path is None:
        raise NovelTransError("원본 파일이 선택되지 않았습니다.")
    return create_project_from_local_file(
        manager=manager,
        name=draft.name,
        input_path=draft.input_path,
        translation=draft.translation,
        parallel=draft.parallel,
        quality=draft.quality,
        export=draft.export,
        episode_spec=draft.episode_spec,
    )


def _resume_project_wizard(prompt: TerminalPrompt, manager: ProjectManager) -> None:
    project = _select_project_wizard(prompt, manager)
    while True:
        prompt.clear()
        manifest = project.load_manifest()
        action = prompt.select(
            manifest.name,
            [
                Choice("미완료/실패 화 번역", "translate"),
                Choice("원문 추가", "add"),
                Choice("원문 추가 후 번역", "add_translate"),
                Choice("출력 다시 만들기", "export"),
                Choice("검증 실행", "verify"),
                Choice("품질 리포트 보기", "report"),
                Choice("용어집 관리", "glossary"),
                Choice("메인으로", "back"),
            ],
            default="translate",
            body=_project_dashboard_lines(project),
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
        if action == "export":
            formats = _choose_formats(prompt, defaults=manifest.export.formats)
            outputs = Exporter().export(project, formats=formats)
            prompt.result("출력 파일 생성 완료", [f"출력: {output}" for output in outputs])
            prompt.pause()
        if action == "verify":
            prompt.result("검증 결과", _verification_lines(project))
            prompt.pause()
        if action == "report":
            prompt.result("품질 리포트", _quality_report_lines(project))
            prompt.pause()
        if action == "glossary":
            _glossary_project_wizard(prompt, project)


def _project_dashboard_lines(project: Project) -> list[str]:
    manifest = project.load_manifest()
    status = project_status(project)
    return [
        f"프로젝트 위치: {project.root}",
        f"작품: {manifest.work.title}",
        f"저자: {manifest.work.author or '알 수 없음'}",
        f"번역 방식: {_backend_label(manifest.translation.backend)}",
        f"모델: {manifest.translation.model}",
        f"출력: {_formats_label(manifest.export.formats)}",
        "",
        f"완료: {format_episode_numbers(status.completed)}",
        f"미번역: {format_episode_numbers(status.pending)}",
        f"실패: {format_episode_numbers(status.failed)}",
    ]


def _add_source_to_project_wizard(prompt: TerminalPrompt, project: Project) -> None:
    source_mode = prompt.select(
        "추가할 원문 입력 방식",
        [
            Choice("파일 선택", "file", "TXT/HTML/ZIP"),
            Choice("클립보드 붙여넣기", "clipboard"),
            Choice("직접 입력", "manual"),
            Choice("편집기로 작성", "editor"),
        ],
        default="file",
    )
    input_path = _source_file_from_mode(prompt, source_mode)
    episode_spec = _choose_episode_spec_wizard(prompt, "가져올 화수 범위")
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
    _glossary_project_wizard(prompt, project)


def _glossary_project_wizard(prompt: TerminalPrompt, project: Project) -> None:
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
            term_type = _choose_term_type_wizard(prompt)
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
            "설정",
            _settings_choices(config, store),
            default="save",
            body=_settings_body_lines(config, store),
        )
        if action == "save":
            config_manager.save(config)
            return config
        _edit_settings_category(prompt, config, store, action)
        config_manager.save(config)


def _settings_body_lines(config: AppConfig, store: CredentialStore) -> list[str]:
    return [
        f"프로젝트 저장소: {config.base_dir}",
        f"번역: {_preset_label(config.default_translation_preset)} / {_backend_label(config.default_translation_backend)}",
        f"결과 파일: {_formats_label(config.default_output_formats)}",
        f"인증: API key {'설정됨' if store.get_api_key() else '없음'}, access token {'설정됨' if store.get_access_token() else '없음'}",
        "세부 항목은 카테고리 안에서 바꿉니다.",
    ]


def _settings_choices(config: AppConfig, store: CredentialStore) -> list[Choice]:
    return [
        Choice("인증", "credentials", "API key 설정됨" if store.get_api_key() else "API key 없음"),
        Choice("번역 기본값", "translation", _preset_label(config.default_translation_preset)),
        Choice("출력 기본값", "output", _formats_label(config.default_output_formats)),
        Choice("안전/정책", "safety", _url_mode_label(config.default_url_collection_mode)),
        Choice("고급 설정", "advanced", "모델 세부값, QA, 저장 위치"),
        Choice("저장하고 돌아가기", "save"),
    ]


def _edit_settings_category(prompt: TerminalPrompt, config: AppConfig, store: CredentialStore, action: str) -> None:
    if action == "credentials":
        _settings_credentials_wizard(prompt, config, store)
    elif action == "translation":
        _settings_category_wizard(
            prompt,
            config,
            store,
            "번역 기본값",
            [
                Choice("기본 원본 입력", "source", _source_mode_label(config.default_source_mode)),
                Choice("기본 번역 범위", "episodes", _episode_spec_label(config.default_episode_spec)),
                Choice("번역 방식", "backend", _backend_label(config.default_translation_backend)),
                Choice("모델", "model", config.default_model),
                Choice("번역 모드", "preset", _preset_label(config.default_translation_preset)),
                Choice("속도", "parallel", _parallel_label(config.default_parallel_episodes)),
            ],
            lambda: [
                f"원본: {_source_mode_label(config.default_source_mode)}",
                f"번역 범위: {_episode_spec_label(config.default_episode_spec)}",
                f"번역: {_preset_label(config.default_translation_preset)} / {_backend_label(config.default_translation_backend)}",
                f"속도: {_parallel_label(config.default_parallel_episodes)}",
            ],
        )
    elif action == "output":
        _settings_category_wizard(
            prompt,
            config,
            store,
            "출력 기본값",
            [
                Choice("결과 파일", "formats", _formats_label(config.default_output_formats)),
                Choice("용어집 부록", "include_glossary", _included_label(config.default_include_glossary)),
                Choice("작가 후기 출력", "author_notes", _included_label(config.default_include_author_notes)),
                Choice("EPUB 세로쓰기", "vertical", _enabled_label(config.default_epub_vertical_writing)),
                Choice("워터마크", "watermark", config.watermark),
            ],
            lambda: [
                f"결과 파일: {_formats_label(config.default_output_formats)}",
                f"용어집 부록: {_included_label(config.default_include_glossary)}",
                f"작가 후기: {_included_label(config.default_include_author_notes)}",
            ],
        )
    elif action == "safety":
        _settings_category_wizard(
            prompt,
            config,
            store,
            "안전/정책",
            [
                Choice("URL 원문 가져오기", "url_mode", _url_mode_label(config.default_url_collection_mode)),
                Choice("권한 메모", "permission_note", "자동 수집 감사 로그에 기록"),
                Choice("정책 자세히 보기", "policy_details", _enabled_label(config.show_policy_details_on_start)),
            ],
            lambda: [
                f"URL 원문 가져오기: {_url_mode_label(config.default_url_collection_mode)}",
                f"정책 자세히 보기: {_enabled_label(config.show_policy_details_on_start)}",
            ],
        )
    elif action == "advanced":
        _settings_category_wizard(
            prompt,
            config,
            store,
            "고급 설정",
            [
                Choice("추론 강도", "reasoning", _reasoning_label(config.default_reasoning_effort)),
                Choice("문체", "style", _style_label(config.default_style)),
                Choice("존댓말/호칭", "honorific", _honorific_label(config.default_honorific_policy)),
                Choice("용어집 엄격도", "glossary", _glossary_strictness_label(config.default_glossary_strictness)),
                Choice("문장 변형 정도", "temperature", str(config.default_temperature)),
                Choice("일본어 호칭 접미사 보존", "suffixes", _enabled_label(config.default_preserve_japanese_suffixes)),
                Choice("작가 후기 번역", "translate_notes", _enabled_label(config.default_translate_author_notes)),
                Choice("루비 괄호 보존", "ruby", _enabled_label(config.default_keep_ruby_as_parentheses)),
                Choice("긴 화 분할", "split", _enabled_label(config.default_split_long_episode)),
                Choice("긴 화 기준 글자 수", "threshold", f"{config.default_long_episode_threshold_chars}자"),
                Choice("번역 품질 검사", "qa", _enabled_label(config.default_run_qa_pass)),
                Choice("이름/용어 흔들림 검사", "term", _enabled_label(config.default_run_term_consistency_pass)),
                Choice("누락 문단 검사", "missing", _enabled_label(config.default_check_missing_paragraphs)),
                Choice("길이 비율 검사", "ratio", _enabled_label(config.default_compare_length_ratio)),
                Choice("금칙어", "banned", f"{len(config.default_banned_terms)}개"),
                Choice("저장 위치", "base_dir", config.base_dir),
                Choice("토큰 단가", "pricing", "비용 추정에 사용"),
            ],
            lambda: [
                f"모델 세부값: 추론 {_reasoning_label(config.default_reasoning_effort)}, 문장 변형 {config.default_temperature}",
                f"검토: 품질 {_enabled_label(config.default_run_qa_pass)}, 용어 {_enabled_label(config.default_run_term_consistency_pass)}",
                f"저장 위치: {config.base_dir}",
            ],
        )


def _settings_category_wizard(
    prompt: TerminalPrompt,
    config: AppConfig,
    store: CredentialStore,
    title: str,
    choices: list[Choice],
    body: Callable[[], list[str]],
) -> None:
    while True:
        action = prompt.select(
            title,
            [*choices, Choice("설정으로 돌아가기", "back")],
            default="back",
            body=body(),
        )
        if action == "back":
            return
        _edit_flat_setting(prompt, config, store, action)


def _edit_flat_setting(prompt: TerminalPrompt, config: AppConfig, store: CredentialStore, action: str) -> None:
    if action == "source":
        config.default_source_mode = prompt.select(
            "기본 원본 입력",
            _source_mode_choices(),
            default=config.default_source_mode,
        )
    elif action == "prompt_source":
        config.prompt_source_mode_on_start = prompt.confirm(
            "새 작업 시작 때 원본 입력 방식을 물어볼까요",
            config.prompt_source_mode_on_start,
        )
    elif action == "episodes":
        config.default_episode_spec = _choose_episode_spec_wizard(prompt, "기본 화수 범위")
    elif action == "url_mode":
        config.default_url_collection_mode = prompt.select(
            "URL 처리 방식",
            _url_collection_choices(),
            default=config.default_url_collection_mode,
        )
    elif action == "permission_note":
        config.default_permission_note = prompt.input(
            "권한 메모",
            config.default_permission_note,
            required=True,
            body="자동 수집 허용 URL에서 감사 로그에 남길 기본 메모입니다.",
        )
    elif action == "policy_details":
        config.show_policy_details_on_start = prompt.confirm(
            "새 작업 중 정책 상세 화면을 보여줄까요",
            config.show_policy_details_on_start,
        )
    elif action == "backend":
        config.default_translation_backend = _choose_backend_wizard(prompt, config.default_translation_backend)
    elif action == "model":
        config.default_model = _choose_model_wizard(prompt, config.default_model, title="기본 모델")
    elif action == "preset":
        preset = prompt.select(
            "번역 모드",
            _translation_preset_choices(),
            default=config.default_translation_preset,
        )
        _apply_translation_preset_to_config(config, preset)
    elif action == "reasoning":
        config.default_reasoning_effort = _choose_reasoning_effort_wizard(prompt, config.default_reasoning_effort)
    elif action == "style":
        config.default_style = _choose_style_wizard(prompt, config.default_style)
    elif action == "honorific":
        config.default_honorific_policy = _choose_honorific_policy_wizard(prompt, config.default_honorific_policy)
    elif action == "glossary":
        config.default_glossary_strictness = _choose_glossary_strictness_wizard(prompt, config.default_glossary_strictness)
    elif action == "temperature":
        config.default_temperature = _choose_temperature_wizard(prompt, config.default_temperature) or 0.3
    elif action == "suffixes":
        config.default_preserve_japanese_suffixes = prompt.confirm(
            "일본어 호칭 접미사를 기본 보존할까요",
            config.default_preserve_japanese_suffixes,
        )
    elif action == "translate_notes":
        config.default_translate_author_notes = prompt.confirm("작가 후기를 기본 번역할까요", config.default_translate_author_notes)
    elif action == "ruby":
        config.default_keep_ruby_as_parentheses = prompt.confirm("루비를 괄호로 기본 보존할까요", config.default_keep_ruby_as_parentheses)
    elif action == "parallel":
        config.default_parallel_episodes = _choose_parallel_episodes_wizard(prompt, config.default_parallel_episodes)
    elif action == "split":
        config.default_split_long_episode = prompt.confirm("긴 화 내부 분할을 기본 사용할까요", config.default_split_long_episode)
    elif action == "threshold":
        config.default_long_episode_threshold_chars = _choose_long_episode_threshold_wizard(
            prompt,
            config.default_long_episode_threshold_chars,
        )
    elif action == "qa":
        config.default_run_qa_pass = prompt.confirm("번역 품질 검사를 기본 실행할까요", config.default_run_qa_pass)
    elif action == "term":
        config.default_run_term_consistency_pass = prompt.confirm(
            "이름/용어 흔들림 검사를 기본 실행할까요",
            config.default_run_term_consistency_pass,
        )
    elif action == "missing":
        config.default_check_missing_paragraphs = prompt.confirm("누락 문단 검사를 기본 실행할까요", config.default_check_missing_paragraphs)
    elif action == "ratio":
        config.default_compare_length_ratio = prompt.confirm("길이 비율 검사를 기본 실행할까요", config.default_compare_length_ratio)
    elif action == "banned":
        raw = prompt.input("금칙어", ", ".join(config.default_banned_terms), body="쉼표로 구분합니다.")
        config.default_banned_terms = [item.strip() for item in raw.split(",") if item.strip()]
    elif action == "formats":
        config.default_output_formats = _choose_formats(prompt, defaults=config.default_output_formats)
    elif action == "include_glossary":
        config.default_include_glossary = prompt.confirm("용어집 부록을 기본 포함할까요", config.default_include_glossary)
    elif action == "author_notes":
        config.default_include_author_notes = prompt.confirm("출력에 작가 후기를 기본 포함할까요", config.default_include_author_notes)
    elif action == "vertical":
        config.default_epub_vertical_writing = prompt.confirm("EPUB 세로쓰기를 기본 사용할까요", config.default_epub_vertical_writing)
    elif action == "watermark":
        config.watermark = prompt.input("워터마크", config.watermark)
    elif action == "base_dir":
        config.base_dir = prompt.input(
            "프로젝트 저장 위치",
            config.base_dir,
            required=True,
            body="새 프로젝트가 저장될 위치입니다. 상대 경로는 현재 실행 위치 기준입니다.",
        )
    elif action == "credentials":
        _settings_credentials_wizard(prompt, config, store)
    elif action == "pricing":
        config.input_price_per_million_tokens = _input_float_wizard(
            prompt,
            "입력 토큰 단가/100만",
            config.input_price_per_million_tokens,
            0.0,
            10000.0,
        )
        config.output_price_per_million_tokens = _input_float_wizard(
            prompt,
            "출력 토큰 단가/100만",
            config.output_price_per_million_tokens,
            0.0,
            10000.0,
        )


def _source_mode_choices() -> list[Choice]:
    return [
        Choice("URL 붙여넣기", "url", "허용 사이트만 자동 수집"),
        Choice("파일 선택", "file", "TXT/HTML/ZIP"),
        Choice("클립보드 붙여넣기", "clipboard"),
        Choice("직접 입력", "manual"),
        Choice("편집기로 작성", "editor"),
    ]


def _url_collection_choices() -> list[Choice]:
    return [
        Choice("정책 허용 시 자동 수집", "auto", "허용 사이트에서만 본문 수집"),
        Choice("사용자 제공 본문 우선", "user-file", "URL은 메타데이터용으로만 사용"),
        Choice("매번 선택", "ask", "사이트 감지 후 처리 방식 선택"),
    ]


def _translation_preset_choices() -> list[Choice]:
    return [
        Choice("빠른 초벌 번역", "fast", "속도 우선"),
        Choice("균형 번역", "balanced", "일반 추천값"),
        Choice("문학적 자연화", "literary", "한국 웹소설 문체 자연화"),
        Choice("직역 보존", "literal", "원문 구조 최대 보존"),
        Choice("용어 일관성 우선", "glossary", "고유명사/설정 일관성 강화"),
    ]


def _choose_parallel_episodes_wizard(prompt: TerminalPrompt, default: int) -> int:
    return int(
        prompt.select(
            "속도",
            _parallel_choices(),
            default=str(default),
            body="동시에 처리할 화 수입니다. 값이 클수록 빠르지만 비용과 실패 재시도 범위가 커질 수 있습니다.",
        )
    )


def _parallel_choices() -> list[Choice]:
    return [
        Choice(_parallel_label(1), "1"),
        Choice(_parallel_label(2), "2"),
        Choice(_parallel_label(4), "4"),
        Choice(_parallel_label(8), "8"),
    ]


def _settings_credentials_wizard(prompt: TerminalPrompt, config: AppConfig, store: CredentialStore) -> None:
    while True:
        action = prompt.select(
            "인증",
            [
                Choice("OpenAI API key 저장/교체", "api_key", "저장됨" if store.get_api_key() else "없음"),
                Choice("OpenAI access token 저장/교체", "access_token", "저장됨" if store.get_access_token() else "없음"),
                Choice("Codex 로그인 상태 확인", "codex_status"),
                Choice("Codex 명령", "codex_command", config.codex_command),
                Choice("Codex 제한 시간", "codex_timeout", f"{config.codex_timeout_seconds}초"),
                Choice("설정으로 돌아가기", "back"),
            ],
            default="back",
            body=[
                f"OpenAI API key: {'설정됨' if store.get_api_key() else '없음'}",
                f"OpenAI access token: {'설정됨' if store.get_access_token() else '없음'}",
            ],
        )
        if action == "back":
            return
        if action == "api_key":
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
                f"Codex 설치: {'확인됨' if codex.is_installed() else '찾지 못함'}",
                f"Codex 로그인: {'확인됨' if authenticated else '필요'}",
            ]
            if detail:
                lines.append(detail)
            prompt.result("Codex 로그인 상태", lines, ok=authenticated)
            prompt.pause()
        elif action == "codex_command":
            config.codex_command = prompt.input("Codex 명령", config.codex_command, required=True)
        elif action == "codex_timeout":
            config.codex_timeout_seconds = prompt.integer("Codex 제한 시간(초)", config.codex_timeout_seconds, 30, 7200)


def _translation_options_for_preset(preset: str, model: str, reasoning_effort: str) -> TranslationOptions:
    options = TranslationOptions(model=model, reasoning_effort=reasoning_effort, preset=preset)
    _apply_translation_preset_to_options(options, preset, reset_reasoning=False)
    return options


def _apply_translation_preset_to_options(
    options: TranslationOptions,
    preset: str,
    *,
    reset_reasoning: bool,
) -> None:
    options.preset = preset
    options.style = "korean_webnovel_balanced"
    options.glossary_strictness = "high"
    options.temperature = 0.3
    if preset == "fast":
        options.glossary_strictness = "medium"
        options.temperature = 0.2
        if reset_reasoning or options.reasoning_effort == "medium":
            options.reasoning_effort = "low"
    elif preset == "balanced":
        if reset_reasoning:
            options.reasoning_effort = "medium"
    elif preset == "literary":
        options.style = "korean_webnovel_literary_naturalized"
        options.temperature = 0.45
        if reset_reasoning:
            options.reasoning_effort = "medium"
    elif preset == "literal":
        options.style = "literal_structure_preserving"
        options.temperature = 0.2
        if reset_reasoning:
            options.reasoning_effort = "medium"
    elif preset == "glossary":
        options.style = "korean_webnovel_term_consistency_first"
        options.glossary_strictness = "strict"
        options.temperature = 0.1
        if reset_reasoning:
            options.reasoning_effort = "medium"


def _apply_translation_preset_to_config(config: AppConfig, preset: str) -> None:
    options = _translation_options_for_preset(preset, config.default_model, config.default_reasoning_effort)
    _apply_translation_preset_to_options(options, preset, reset_reasoning=True)
    config.default_translation_preset = preset
    config.default_reasoning_effort = options.reasoning_effort
    config.default_style = options.style
    config.default_glossary_strictness = options.glossary_strictness
    config.default_temperature = options.temperature or 0.3


def _edit_translation_option(prompt: TerminalPrompt, translation: TranslationOptions, action: str) -> None:
    if action == "reasoning":
        translation.reasoning_effort = _choose_reasoning_effort_wizard(prompt, translation.reasoning_effort)
    elif action == "style":
        translation.style = _choose_style_wizard(prompt, translation.style)
    elif action == "honorific":
        translation.honorific_policy = _choose_honorific_policy_wizard(prompt, translation.honorific_policy)
    elif action == "glossary":
        translation.glossary_strictness = _choose_glossary_strictness_wizard(prompt, translation.glossary_strictness)
    elif action == "temperature":
        translation.temperature = _choose_temperature_wizard(prompt, translation.temperature)
    elif action == "suffixes":
        translation.preserve_japanese_suffixes = prompt.confirm(
            "일본어 호칭 접미사를 보존할까요",
            translation.preserve_japanese_suffixes,
        )
    elif action == "translate_notes":
        translation.translate_author_notes = prompt.confirm("작가 후기를 번역할까요", translation.translate_author_notes)
    elif action == "ruby":
        translation.keep_ruby_as_parentheses = prompt.confirm("루비를 괄호로 보존할까요", translation.keep_ruby_as_parentheses)


def _choose_episode_spec_wizard(prompt: TerminalPrompt, title: str) -> str:
    mode = prompt.select(
        title,
        [
            Choice("전체 화", "all", "프로젝트가 가진 모든 화"),
            Choice("한 화만", "single", "예: 12"),
            Choice("연속 범위", "range", "예: 1-10"),
            Choice("몇 개만 골라서", "list", "예: 1,3,8,12"),
            Choice("최신 몇 화", "latest", "예: 최신 5"),
            Choice("직접 입력", "custom", "전체, 1-10, 5,8,12-20 같은 형식"),
        ],
        default="all",
        body=[
            "화수는 나중에 프로젝트에 저장된 원문 기준으로 선택됩니다.",
            "특정 사이트 URL이 한 화를 가리키면, 사용자 제공 단일 파일도 해당 화 번호로 맞춰집니다.",
        ],
    )
    if mode == "all":
        return "all"
    if mode == "single":
        return str(prompt.integer("화 번호", 1, 1, 99999))
    if mode == "range":
        start = prompt.integer("시작 화", 1, 1, 99999)
        end = prompt.integer("끝 화", start, start, 99999)
        return f"{start}-{end}"
    if mode == "list":
        return prompt.input(
            "가져올 화 번호 목록",
            "1,3,5",
            required=True,
            body="쉼표로 구분합니다. 공백은 있어도 됩니다.",
        )
    if mode == "latest":
        count = prompt.select(
            "최신 몇 화",
            [
                Choice("최신 1화", "1"),
                Choice("최신 3화", "3"),
                Choice("최신 5화", "5"),
                Choice("최신 10화", "10"),
                Choice("직접 입력", "custom"),
            ],
            default="5",
        )
        if count == "custom":
            count = str(prompt.integer("최신 화 수", 5, 1, 999))
        return f"최신 {count}"
    raw = prompt.input(
        "화수 범위 직접 입력",
        "전체",
        required=True,
        body=[
            "사용 가능한 예시:",
            "- 전체",
            "- 1-10",
            "- 5,8,12-20",
            "- 최신 5",
        ],
    )
    return "all" if raw in {"전체", "모두", "all"} else raw


def _choose_model_wizard(prompt: TerminalPrompt, default: str, title: str = "모델") -> str:
    configured = default.strip() or "gpt-5.5"
    choices = [Choice(f"현재 기본값 사용 ({configured})", configured)]
    if configured != "gpt-5.5":
        choices.append(Choice("gpt-5.5", "gpt-5.5", "프로젝트 기본 추천값"))
    choices.append(Choice("직접 입력", "__custom__", "OpenAI/Codex 환경에서 사용할 모델명을 알고 있을 때"))
    selected = prompt.select(
        title,
        choices,
        default=configured,
        body=[
            "모델명을 모르겠으면 현재 기본값을 사용하세요.",
            "직접 입력은 새 모델이나 사내 호환 엔드포인트를 쓰는 경우에만 필요합니다.",
        ],
    )
    if selected == "__custom__":
        return prompt.input("모델명 직접 입력", configured, required=True, body="예: gpt-5.5")
    return selected


def _choose_reasoning_effort_wizard(prompt: TerminalPrompt, default: str) -> str:
    return prompt.select(
        "추론 강도",
        [
            Choice("낮음", "low", "빠른 초벌 번역"),
            Choice("보통", "medium", "균형 추천"),
            Choice("높음", "high", "비용/시간보다 품질 우선"),
        ],
        default=default if default in {"low", "medium", "high"} else "medium",
    )


def _choose_style_wizard(prompt: TerminalPrompt, default: str) -> str:
    return _select_or_custom_wizard(
        prompt,
        "문체 프로필",
        [
            Choice("한국 웹소설 균형체", "korean_webnovel_balanced", "기본 추천"),
            Choice("문학적 자연화", "korean_webnovel_literary_naturalized", "문장을 더 자연스럽게 다듬음"),
            Choice("직역 구조 보존", "literal_structure_preserving", "원문 순서와 표현을 더 보존"),
            Choice("용어 일관성 우선", "korean_webnovel_term_consistency_first", "고유명사와 설정 표기 고정"),
        ],
        default,
        "프롬프트에 그대로 들어갈 스타일 키입니다. 잘 모르겠으면 한국 웹소설 균형체를 쓰세요.",
    )


def _choose_honorific_policy_wizard(prompt: TerminalPrompt, default: str) -> str:
    return _select_or_custom_wizard(
        prompt,
        "존댓말/호칭 정책",
        [
            Choice("상황 맞춤", "adaptive", "기본 추천"),
            Choice("원문 격식 보존", "preserve_formality", "존댓말/반말 차이를 더 엄격히 유지"),
            Choice("한국어 자연화", "korean_natural", "일본식 호칭을 줄이고 자연스럽게 처리"),
            Choice("원문 호칭 우선", "source_suffix_sensitive", "님/씨/짱/군 같은 호칭 차이를 더 보존"),
        ],
        default,
        "캐릭터 말투와 호칭을 처리하는 정책 이름입니다.",
    )


def _choose_glossary_strictness_wizard(prompt: TerminalPrompt, default: str) -> str:
    return prompt.select(
        "용어집 엄격도",
        [
            Choice("낮음", "low", "문맥상 자연스러우면 변형 허용"),
            Choice("보통", "medium", "핵심 고유명사 중심"),
            Choice("높음", "high", "기본 추천"),
            Choice("매우 엄격", "strict", "스킬명/지명/인명 흔들림 최소화"),
        ],
        default=default if default in {"low", "medium", "high", "strict"} else "high",
    )


def _choose_temperature_wizard(prompt: TerminalPrompt, default: float | None) -> float | None:
    current = 0.3 if default is None else default
    value = prompt.select(
        "문장 변형 정도",
        [
            Choice("낮음 0.1", "0.1", "용어/표현 일관성 우선"),
            Choice("균형 0.3", "0.3", "기본 추천"),
            Choice("자연화 0.45", "0.45", "문장 다듬기 여지 확대"),
            Choice("높음 0.6", "0.6", "창의적 재구성 증가"),
            Choice("직접 입력", "custom", f"현재값: {current}"),
        ],
        default=str(current) if current in {0.1, 0.3, 0.45, 0.6} else "0.3",
        body="값이 높을수록 표현 변화가 커질 수 있습니다. 번역 일관성이 중요하면 낮게 두세요.",
    )
    if value != "custom":
        return float(value)
    return _input_float_wizard(prompt, "문장 변형 정도 직접 입력", current, 0.0, 2.0)


def _choose_long_episode_threshold_wizard(prompt: TerminalPrompt, default: int) -> int:
    value = prompt.select(
        "긴 화 기준 글자 수",
        [
            Choice("10,000자", "10000", "자주 분할"),
            Choice("20,000자", "20000", "기본 추천"),
            Choice("40,000자", "40000", "긴 화만 분할"),
            Choice("직접 입력", "custom", f"현재값: {default}"),
        ],
        default=str(default) if default in {10000, 20000, 40000} else "20000",
        body="한 화가 이 글자 수를 넘으면 내부 분할 대상이 됩니다.",
    )
    if value != "custom":
        return int(value)
    return prompt.integer("긴 화 기준 글자 수 직접 입력", default, 1000, 200000)


def _choose_term_type_wizard(prompt: TerminalPrompt) -> str:
    return _select_or_custom_wizard(
        prompt,
        "용어 유형",
        [
            Choice("인명", "person"),
            Choice("지명", "place"),
            Choice("조직명", "organization"),
            Choice("기술/스킬명", "skill"),
            Choice("칭호", "title"),
            Choice("고유 표현", "proper_noun"),
            Choice("말투", "speech_style"),
            Choice("설명/묘사", "description"),
        ],
        "proper_noun",
        "용어집의 분류값입니다. 확실하지 않으면 고유 표현을 쓰세요.",
    )


def _select_or_custom_wizard(
    prompt: TerminalPrompt,
    title: str,
    choices: list[Choice],
    default: str,
    custom_help: str,
) -> str:
    values = {choice.value for choice in choices}
    selected = prompt.select(
        title,
        [*choices, Choice("직접 입력", "__custom__", "목록에 없을 때만 사용")],
        default=default if default in values else "__custom__",
        body=custom_help,
    )
    if selected == "__custom__":
        return prompt.input(f"{title} 직접 입력", default, required=True, body=custom_help)
    return selected


def _input_float_wizard(
    prompt: TerminalPrompt,
    title: str,
    default: float,
    minimum: float,
    maximum: float,
) -> float:
    while True:
        raw = prompt.input(title, str(default), required=True)
        try:
            value = float(raw)
        except ValueError:
            prompt.panel("입력 오류", "숫자를 입력하세요.")
            prompt.pause()
            continue
        if minimum <= value <= maximum:
            return value
        prompt.panel("입력 오류", f"{minimum}부터 {maximum} 사이 값을 입력하세요.")
        prompt.pause()


def _choose_backend_wizard(prompt: TerminalPrompt, default: str, with_project_default: bool = False) -> str:
    normalized_default = normalize_translation_backend(default) if default else ""
    choices: list[Choice] = []
    if with_project_default:
        choices.append(Choice("프로젝트 기본값", "", _backend_label(normalized_default)))
    choices.extend(
        [
            Choice("자동 선택", "auto", "OpenAI 자격 증명 우선, 없으면 Codex 로그인 사용"),
            Choice("OpenAI로 번역", "openai", "저장된 API key 또는 access token 사용"),
            Choice("Codex로 번역", "codex", "Codex 로그인 세션 사용"),
            Choice("모의 실행", "dry-run", "실제 번역 없이 파일 생성 흐름 검증"),
        ]
    )
    return prompt.select(
        "번역 방식",
        choices,
        default=normalized_default or "auto",
        body=[
            "잘 모르겠으면 자동 선택을 쓰세요.",
            "OpenAI API key가 없고 Codex 로그인이 되어 있으면 자동 선택이 Codex를 사용합니다.",
        ],
    )


def _choose_formats(prompt: TerminalPrompt, defaults: list[str] | None = None) -> list[str]:
    return prompt.multiselect(
        "출력 형식",
        [
            Choice("TXT", "txt", "가장 단순한 텍스트 출력"),
            Choice("EPUB", "epub", "전자책 리더용"),
        ],
        defaults=defaults or ["txt", "epub"],
    )


def _run_project_translation(
    prompt: TerminalPrompt,
    project: Project,
    backend: str | None,
    resume: bool,
    confirm_start: bool = True,
) -> None:
    manifest = project.load_manifest()
    selected_backend = backend or manifest.translation.backend
    dry_run = _should_use_dry_run(prompt, selected_backend)
    if confirm_start:
        estimate = estimate_project_translation(project, resume=resume)
        summary = [
            f"프로젝트: {project.root}",
            f"대상 화수: {estimate.episode_count}",
            f"예상 토큰: {estimate.estimated_total_tokens}",
            f"번역 방식: {_backend_label('dry-run' if dry_run else selected_backend)}",
        ]
        if estimate.estimated_cost is not None:
            summary.insert(3, f"예상 비용: ${estimate.estimated_cost:.4f}")
        if not prompt.confirm("번역을 시작할까요", default=True, body=summary):
            return
    outputs = _run_translation_with_progress_wizard(
        prompt,
        project,
        backend="dry-run" if dry_run else selected_backend,
        resume=resume,
        runner=lambda: run_translation_and_export(
            project,
            dry_run=dry_run,
            resume=resume,
            backend=selected_backend,
        ),
    )
    prompt.result("완료", [f"프로젝트: {project.root}", "", *[f"출력: {output}" for output in outputs]])
    prompt.pause()


def _run_translation_with_progress_wizard(
    prompt: TerminalPrompt,
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
        except Exception as exc:  # noqa: BLE001 - re-raised on the UI thread.
            state["error"] = exc

    thread = Thread(target=worker, daemon=True)
    thread.start()
    while thread.is_alive():
        _render_progress_wizard(prompt, project, target_numbers, started_at, backend)
        thread.join(timeout=1.0)
    _render_progress_wizard(prompt, project, target_numbers, started_at, backend)
    if "error" in state:
        raise state["error"]  # type: ignore[misc]
    return list(state.get("outputs", []))


def _render_progress_wizard(
    prompt: TerminalPrompt,
    project: Project,
    target_numbers: list[int],
    started_at: float,
    backend: str,
) -> None:
    snapshot = snapshot_project_progress(project, target_numbers, started_at)
    prompt.clear()
    prompt.banner("번역 진행 중", "대기/진행/완료 상태를 1초마다 갱신합니다.")
    prompt.panel("작업 상태", format_progress_lines(snapshot, backend=_backend_label(backend)))
    prompt.panel("프로젝트", str(project.root))


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
        body.append("Codex 로그인도 확인되지 않았습니다.")
    return prompt.confirm("모의 실행으로 진행할까요", default=True, body=body)


def _has_openai_credentials(store: CredentialStore) -> bool:
    return bool(store.get_api_key() or store.get_access_token())


def _has_codex_credentials() -> bool:
    authenticated, _ = CodexCLI().login_status()
    return authenticated


def _source_file_from_mode(prompt: TerminalPrompt, source_mode: str) -> Path:
    if source_mode == "file":
        return Path(prompt.input("원본 파일 경로", required=True, body="TXT/HTML/ZIP을 사용할 수 있습니다.")).expanduser()
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
            Choice("파일 선택", "file", "TXT/HTML/ZIP"),
            Choice("클립보드 붙여넣기", "clipboard"),
            Choice("직접 입력", "manual"),
            Choice("편집기로 작성", "editor"),
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
        target = entry.target or "(번역 대기)"
        lines.append(f"- {entry.source} -> {target} [{entry.type}, {locked}, {entry.confidence:.2f}]")
    conflicts = glossary.conflict_snapshot(limit=5)
    if conflicts:
        lines.append("")
        lines.append("충돌")
        for conflict in conflicts:
            lines.append(f"- {conflict.source}: {conflict.previous} / {conflict.suggested}")
    return lines


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
    lines = [f"결과: {'정상' if report.ok else '문제 있음'}"]
    lines.extend(f"확인: {item}" for item in report.checked)
    lines.extend(f"문제: {issue}" for issue in report.issues)
    return lines


def _quality_report_lines(project: Project) -> list[str]:
    path = project.logs_dir / "quality_report.txt"
    if not path.exists():
        raise NovelTransError(f"품질 리포트가 없습니다: {path}")
    return path.read_text(encoding="utf-8").rstrip().splitlines()


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
        if char in {"\x7f", "\b"}:
            return "back"
        if char == " ":
            return "space"
        if char.lower() == "q":
            return "q"
        return char
    finally:
        termios.tcsetattr(fd, termios.TCSADRAIN, previous)
