"""Textual application screens for NovelTrans."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Callable, cast

from textual.app import App, ComposeResult
from textual.containers import Horizontal, Vertical, VerticalScroll
from textual.screen import Screen
from textual import work
from textual.widgets import Button, Checkbox, Footer, Header, Input, Select, Static

from noveltrans import __version__
from noveltrans.config import ConfigManager, CredentialStore
from noveltrans.errors import NovelTransError, PolicyViolation
from noveltrans.exporters import Exporter
from noveltrans.glossary import GlossaryManager
from noveltrans.models import ExportOptions, GlossaryEntry, ParallelOptions, QualityOptions, TranslationOptions
from noveltrans.project import Project, ProjectManager
from noveltrans.translator import CodexCLI, normalize_translation_backend
from noveltrans.verify import verify_project
from noveltrans.workflow import (
    add_source_episodes_from_local_file,
    create_project_from_local_file,
    create_project_from_url,
    estimate_project_translation,
    run_translation_and_export,
)


BackendValue = str


@dataclass(slots=True)
class NewProjectRequest:
    name: str
    source_mode: str
    source: str
    fallback_file: str
    episode_spec: str
    translation: TranslationOptions
    parallel: ParallelOptions
    quality: QualityOptions
    export: ExportOptions
    confirm_rights: bool
    no_redistribute: bool
    allow_auto_fetch: bool
    permission_note: str


class NovelTransApp(App[None]):
    """Primary Textual app."""

    CSS = """
    Screen {
        layout: vertical;
        background: #070a0f;
        color: #d6deeb;
    }

    Header, Footer {
        background: #070a0f;
        color: #8b949e;
    }

    Header {
        text-style: bold;
    }

    .page {
        background: #070a0f;
        padding: 1 3 2 3;
        height: 1fr;
        align-horizontal: center;
    }

    .shell {
        width: 100%;
        max-width: 118;
        height: auto;
    }

    .title {
        text-style: bold;
        color: #f0f6fc;
        margin-bottom: 0;
    }

    .muted {
        color: #8b949e;
        margin-bottom: 1;
    }

    .menu {
        margin-top: 1;
    }

    .menu Button {
        width: 100%;
        height: 3;
        min-height: 3;
        margin-bottom: 1;
        padding: 0 2;
        border: none;
        background: #0d1117;
        color: #c9d1d9;
        content-align: left middle;
    }

    .menu Button:focus {
        background: #1f6feb;
        color: #ffffff;
        text-style: bold;
    }

    .row {
        height: auto;
        margin-bottom: 1;
    }

    .row > * {
        width: 1fr;
        margin-right: 1;
    }

    Input, Select {
        height: 3;
        margin-bottom: 1;
        background: #0d1117;
        color: #f0f6fc;
        border: tall #30363d;
    }

    Input:focus, Select:focus {
        border: tall #58a6ff;
    }

    Button {
        height: 3;
        min-height: 3;
        border: tall #30363d;
        background: #161b22;
        color: #c9d1d9;
    }

    Button:focus {
        border: tall #58a6ff;
        color: #ffffff;
    }

    Button.-primary {
        background: #1f6feb;
        color: #ffffff;
        text-style: bold;
    }

    Checkbox {
        margin-bottom: 1;
        color: #c9d1d9;
    }

    #status, #log, #project-status, #glossary-list, #settings-status {
        min-height: 5;
        border: tall #30363d;
        background: #0d1117;
        color: #c9d1d9;
        padding: 1 2;
        margin-bottom: 1;
    }
    """

    BINDINGS = [
        ("q", "quit", "Quit"),
        ("m", "main_menu", "Main"),
        ("d", "toggle_dark", "Dark"),
    ]

    def __init__(self, config_manager: ConfigManager | None = None) -> None:
        super().__init__()
        self.config_manager = config_manager or ConfigManager()
        self.config = self.config_manager.load()
        self.project_manager = ProjectManager(self.config.base_dir)

    def on_mount(self) -> None:
        self.title = f"NovelTrans {__version__}"
        self.push_screen(MainMenuScreen())

    def refresh_config(self) -> None:
        self.config = self.config_manager.load()
        self.project_manager = ProjectManager(self.config.base_dir)

    def save_config(self) -> None:
        self.config_manager.save(self.config)
        self.project_manager = ProjectManager(self.config.base_dir)

    def action_main_menu(self) -> None:
        self.pop_to_screen(MainMenuScreen())

    def pop_to_screen(self, screen: Screen[None]) -> None:
        self.switch_screen(screen)


def app_of(screen: Screen[None]) -> NovelTransApp:
    return cast(NovelTransApp, screen.app)


class BaseScreen(Screen[None]):
    def compose(self) -> ComposeResult:
        yield Header()
        with VerticalScroll(classes="page"):
            with Vertical(classes="shell"):
                yield from self.compose_body()
        yield Footer()

    def compose_body(self) -> ComposeResult:
        yield Static("NovelTrans")

    def set_status(self, text: str, widget_id: str = "status") -> None:
        self.query_one(f"#{widget_id}", Static).update(text)

    def value(self, widget_id: str) -> str:
        return self.query_one(f"#{widget_id}", Input).value.strip()

    def select_value(self, widget_id: str) -> str:
        value = self.query_one(f"#{widget_id}", Select).value
        return "" if value is None else str(value)

    def checkbox_value(self, widget_id: str) -> bool:
        return bool(self.query_one(f"#{widget_id}", Checkbox).value)

    def push_main(self) -> None:
        app_of(self).action_main_menu()


class MainMenuScreen(BaseScreen):
    def compose_body(self) -> ComposeResult:
        app = app_of(self)
        yield Static("NovelTrans", classes="title")
        yield Static(
            f"authorized translation workspace  ·  {app.config.default_translation_backend}  ·  {app.config.default_model}",
            classes="muted",
        )
        with Vertical(classes="menu"):
            yield Button("1  새 번역 프로젝트 만들기        URL 또는 로컬 파일에서 시작", id="new-project", variant="primary")
            yield Button("2  기존 프로젝트 이어서 번역      상태 확인, 원문 추가, 재개", id="resume-project")
            yield Button("3  용어집 관리                   용어 추가, 잠금, 충돌 해결", id="glossary")
            yield Button("4  출력 파일 다시 생성           txt / docx / epub", id="exports")
            yield Button("5  설정                          모델, 백엔드, 인증", id="settings")
            yield Button("0  종료", id="quit")

    def on_button_pressed(self, event: Button.Pressed) -> None:
        button_id = event.button.id
        if button_id == "new-project":
            self.app.push_screen(NewProjectScreen())
        elif button_id == "resume-project":
            self.app.push_screen(ProjectSelectScreen("resume"))
        elif button_id == "glossary":
            self.app.push_screen(ProjectSelectScreen("glossary"))
        elif button_id == "exports":
            self.app.push_screen(ProjectSelectScreen("exports"))
        elif button_id == "settings":
            self.app.push_screen(SettingsScreen())
        elif button_id == "quit":
            self.app.exit()


class NewProjectScreen(BaseScreen):
    def compose_body(self) -> ComposeResult:
        app = app_of(self)
        yield Static("새 번역 프로젝트", classes="title")
        yield Static("자동 수집은 사이트 정책 게이트를 통과한 경우에만 실행됩니다.", classes="muted")
        yield Input(placeholder="프로젝트 이름", id="name", value="my_novel")
        yield Select(
            [
                ("URL 입력", "url"),
                ("TXT/HTML/ZIP 파일", "file"),
            ],
            id="source-mode",
            value="file",
        )
        yield Input(placeholder="URL 또는 파일 경로", id="source")
        yield Input(placeholder="자동 수집 불가 URL용 사용자 제공 파일 경로", id="fallback-file")
        yield Input(placeholder="화수 범위: all, 1-10, 5,8,12-20, 최신 5", id="episode-spec", value="all")
        with Horizontal(classes="row"):
            yield Select(_backend_options(), id="backend", value=app.config.default_translation_backend)
            yield Input(placeholder="모델", id="model", value=app.config.default_model)
            yield Input(placeholder="동시 화수 1-8", id="parallel", value=str(app.config.default_parallel_episodes))
        yield Input(placeholder="출력 형식", id="formats", value="txt,docx,epub")
        yield Checkbox("나는 이 텍스트를 번역할 권한이 있다", id="confirm-rights")
        yield Checkbox("결과물을 무단 배포하지 않는다", id="no-redistribute")
        yield Checkbox("URL 자동 수집 조건을 충족하며 처리 권한이 있다", id="allow-auto-fetch")
        yield Input(placeholder="권한/라이선스 근거 메모", id="permission-note")
        yield Checkbox("QA 패스 실행", id="run-qa", value=True)
        yield Checkbox("용어 일관성 검사", id="term-qa", value=True)
        yield Checkbox("작가 후기 출력 포함", id="author-notes", value=True)
        with Horizontal(classes="row"):
            yield Button("실행", id="run", variant="primary")
            yield Button("메인으로", id="back")
        yield Static("", id="status")

    def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "back":
            self.push_main()
            return
        if event.button.id != "run":
            return
        try:
            request = self._request()
        except NovelTransError as exc:
            self.set_status(f"오류: {exc}")
            return
        app_of(self).push_screen(TranslationRunScreen.new_project(request, app_of(self).project_manager))

    def _request(self) -> NewProjectRequest:
        name = self.value("name") or "my_novel"
        source = self.value("source")
        if not source:
            raise NovelTransError("URL 또는 파일 경로가 필요합니다.")
        backend = normalize_translation_backend(self.select_value("backend") or "openai")
        try:
            parallel_count = int(self.value("parallel") or "4")
        except ValueError as exc:
            raise NovelTransError("동시 화수는 숫자여야 합니다.") from exc
        if not 1 <= parallel_count <= 8:
            raise NovelTransError("동시 화수는 1부터 8 사이여야 합니다.")
        translation = TranslationOptions(model=self.value("model") or "gpt-5.5", backend=backend)
        parallel = ParallelOptions(max_parallel_episodes=parallel_count)
        quality = QualityOptions(
            run_qa_pass=self.checkbox_value("run-qa"),
            run_term_consistency_pass=self.checkbox_value("term-qa"),
        )
        export = ExportOptions(
            formats=_formats(self.value("formats")),
            include_author_notes=self.checkbox_value("author-notes"),
            watermark=app_of(self).config.watermark,
        )
        return NewProjectRequest(
            name=name,
            source_mode=self.select_value("source-mode") or "file",
            source=source,
            fallback_file=self.value("fallback-file"),
            episode_spec=self.value("episode-spec") or "all",
            translation=translation,
            parallel=parallel,
            quality=quality,
            export=export,
            confirm_rights=self.checkbox_value("confirm-rights"),
            no_redistribute=self.checkbox_value("no-redistribute"),
            allow_auto_fetch=self.checkbox_value("allow-auto-fetch"),
            permission_note=self.value("permission-note"),
        )


class TranslationRunScreen(BaseScreen):
    def __init__(
        self,
        title: str,
        runner: Callable[[], tuple[Project, list[Path]]],
    ) -> None:
        super().__init__()
        self.run_title = title
        self.runner = runner

    @classmethod
    def new_project(cls, request: NewProjectRequest, manager: ProjectManager) -> TranslationRunScreen:
        def runner() -> tuple[Project, list[Path]]:
            if not request.confirm_rights or not request.no_redistribute:
                raise PolicyViolation("권한 확인과 재배포 금지 확인이 필요합니다.")
            if request.source_mode == "url":
                project = create_project_from_url(
                    manager=manager,
                    name=request.name,
                    url=request.source,
                    translation=request.translation,
                    parallel=request.parallel,
                    quality=request.quality,
                    export=request.export,
                    episode_spec=request.episode_spec,
                    user_permission=request.allow_auto_fetch,
                    permission_evidence=request.permission_note,
                    fallback_file=Path(request.fallback_file).expanduser() if request.fallback_file else None,
                )
            else:
                project = create_project_from_local_file(
                    manager=manager,
                    name=request.name,
                    input_path=Path(request.source).expanduser(),
                    translation=request.translation,
                    parallel=request.parallel,
                    quality=request.quality,
                    export=request.export,
                    episode_spec=request.episode_spec,
                )
            outputs = run_translation_and_export(project, backend=request.translation.backend, resume=False)
            return project, outputs

        return cls("새 프로젝트 번역 실행", runner)

    @classmethod
    def existing_project(
        cls,
        project: Project,
        backend: str | None = None,
        formats: list[str] | None = None,
    ) -> TranslationRunScreen:
        def runner() -> tuple[Project, list[Path]]:
            outputs = run_translation_and_export(project, backend=backend, formats=formats, resume=True)
            return project, outputs

        return cls("기존 프로젝트 이어서 번역", runner)

    def compose_body(self) -> ComposeResult:
        yield Static(self.run_title, classes="title")
        yield Static("번역 작업을 실행 중입니다. 완료될 때까지 이 화면을 유지하세요.", classes="muted")
        yield Static("대기 중", id="status")
        with Horizontal(classes="row"):
            yield Button("메인으로", id="back")

    def on_mount(self) -> None:
        self.set_status("작업 시작")
        self.run_job()

    @work(thread=True)
    def run_job(self) -> None:
        try:
            project, outputs = self.runner()
        except Exception as exc:  # noqa: BLE001 - UI must show user-facing failure.
            self.app.call_from_thread(self._failed, exc)
            return
        self.app.call_from_thread(self._completed, project, outputs)

    def _completed(self, project: Project, outputs: list[Path]) -> None:
        lines = [f"완료: {project.root}", ""]
        lines.extend(str(path) for path in outputs)
        self.set_status("\n".join(lines))

    def _failed(self, exc: Exception) -> None:
        self.set_status(f"오류: {exc}")

    def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "back":
            self.push_main()


class ProjectSelectScreen(BaseScreen):
    def __init__(self, target: str) -> None:
        super().__init__()
        self.target = target
        self.projects: list[Project] = []

    def compose_body(self) -> ComposeResult:
        self.projects = app_of(self).project_manager.list_projects()
        title = {
            "resume": "프로젝트 선택",
            "glossary": "용어집 프로젝트 선택",
            "exports": "출력 재생성 프로젝트 선택",
        }.get(self.target, "프로젝트 선택")
        yield Static(title, classes="title")
        if not self.projects:
            yield Static("프로젝트가 없습니다.", id="status")
        else:
            with Vertical(classes="menu"):
                for index, project in enumerate(self.projects):
                    yield Button(_project_label(project), id=f"project-{index}")
        yield Button("메인으로", id="back")

    def on_button_pressed(self, event: Button.Pressed) -> None:
        button_id = event.button.id or ""
        if button_id == "back":
            self.push_main()
            return
        if not button_id.startswith("project-"):
            return
        project = self.projects[int(button_id.split("-", 1)[1])]
        if self.target == "resume":
            self.app.push_screen(ProjectDashboardScreen(project))
        elif self.target == "glossary":
            self.app.push_screen(GlossaryScreen(project))
        elif self.target == "exports":
            self.app.push_screen(ExportScreen(project))


class ProjectDashboardScreen(BaseScreen):
    def __init__(self, project: Project) -> None:
        super().__init__()
        self.project = project

    def compose_body(self) -> ComposeResult:
        yield Static(_project_label(self.project), classes="title")
        yield Static("", id="project-status")
        yield Static("추가 원문 가져오기", classes="title")
        yield Input(placeholder="TXT/HTML/ZIP 파일 경로", id="source-path")
        yield Input(placeholder="가져올 화수 범위", id="episode-spec", value="all")
        yield Checkbox("기존 화 번호도 새 원문으로 교체", id="replace-existing")
        with Horizontal(classes="row"):
            yield Select(_backend_options(with_default=True), id="backend", value="")
            yield Input(placeholder="출력 형식", id="formats", value="txt,docx,epub")
        with Horizontal(classes="row"):
            yield Button("원문 추가", id="add-source")
            yield Button("원문 추가 후 번역", id="add-and-translate", variant="primary")
            yield Button("미완료 번역", id="translate")
        with Horizontal(classes="row"):
            yield Button("출력 재생성", id="exports")
            yield Button("용어집", id="glossary")
            yield Button("검증", id="verify")
            yield Button("메인으로", id="back")
        yield Static("", id="status")

    def on_mount(self) -> None:
        self._refresh_status()

    def _refresh_status(self) -> None:
        estimate = estimate_project_translation(self.project, resume=True)
        counts = self.project.db.counts_by_status()
        self.query_one("#project-status", Static).update(
            f"상태: {counts}\n미완료 대상 화수: {estimate.episode_count}\n프로젝트: {self.project.root}"
        )

    def on_button_pressed(self, event: Button.Pressed) -> None:
        button_id = event.button.id
        if button_id == "back":
            self.push_main()
        elif button_id == "glossary":
            self.app.push_screen(GlossaryScreen(self.project))
        elif button_id == "exports":
            self.app.push_screen(ExportScreen(self.project))
        elif button_id == "verify":
            report = verify_project(self.project)
            lines = [f"ok={str(report.ok).lower()}"]
            lines.extend(f"checked={item}" for item in report.checked)
            lines.extend(f"issue={issue}" for issue in report.issues)
            self.set_status("\n".join(lines))
        elif button_id in {"add-source", "add-and-translate"}:
            self._add_source(translate=button_id == "add-and-translate")
        elif button_id == "translate":
            backend = self.select_value("backend") or None
            formats = _formats(self.value("formats"))
            self.app.push_screen(TranslationRunScreen.existing_project(self.project, backend=backend, formats=formats))

    def _add_source(self, translate: bool) -> None:
        path = self.value("source-path")
        if not path:
            self.set_status("오류: 원문 파일 경로가 필요합니다.")
            return
        try:
            imported = add_source_episodes_from_local_file(
                project=self.project,
                input_path=Path(path).expanduser(),
                episode_spec=self.value("episode-spec") or "all",
                replace_existing=self.checkbox_value("replace-existing"),
            )
        except Exception as exc:  # noqa: BLE001 - UI must show user-facing failure.
            self.set_status(f"오류: {exc}")
            return
        self._refresh_status()
        self.set_status("가져온 화: " + (", ".join(str(item) for item in imported) if imported else "없음"))
        if translate:
            backend = self.select_value("backend") or None
            formats = _formats(self.value("formats"))
            self.app.push_screen(TranslationRunScreen.existing_project(self.project, backend=backend, formats=formats))


class ExportScreen(BaseScreen):
    def __init__(self, project: Project) -> None:
        super().__init__()
        self.project = project

    def compose_body(self) -> ComposeResult:
        yield Static("출력 파일 다시 생성", classes="title")
        yield Static(_project_label(self.project), classes="muted")
        yield Input(placeholder="출력 형식", id="formats", value="txt,docx,epub")
        with Horizontal(classes="row"):
            yield Button("생성", id="export", variant="primary")
            yield Button("메인으로", id="back")
        yield Static("", id="status")

    def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "back":
            self.push_main()
            return
        if event.button.id == "export":
            try:
                outputs = Exporter().export(self.project, formats=_formats(self.value("formats")))
            except Exception as exc:  # noqa: BLE001
                self.set_status(f"오류: {exc}")
                return
            self.set_status("생성 완료\n" + "\n".join(str(path) for path in outputs))


class GlossaryScreen(BaseScreen):
    def __init__(self, project: Project) -> None:
        super().__init__()
        self.project = project

    def compose_body(self) -> ComposeResult:
        yield Static("용어집 관리", classes="title")
        yield Static(_project_label(self.project), classes="muted")
        yield Static("", id="glossary-list")
        with Horizontal(classes="row"):
            yield Input(placeholder="원문 용어", id="source")
            yield Input(placeholder="번역", id="target")
            yield Input(placeholder="유형", id="term-type", value="proper_noun")
        yield Input(placeholder="메모", id="notes")
        yield Checkbox("잠금", id="locked")
        with Horizontal(classes="row"):
            yield Button("추가/수정", id="save", variant="primary")
            yield Button("용어 잠금", id="lock")
            yield Button("충돌 새 번역 적용", id="resolve-new")
            yield Button("충돌 기존 유지", id="resolve-keep")
            yield Button("메인으로", id="back")
        yield Static("", id="status")

    def on_mount(self) -> None:
        self._refresh()

    def _manager(self) -> GlossaryManager:
        return GlossaryManager(self.project.glossary_dir)

    def _refresh(self) -> None:
        manager = self._manager()
        entries = manager.snapshot(limit=30)
        conflicts = manager.conflict_snapshot(limit=10)
        lines = ["최근 용어"]
        if entries:
            lines.extend(
                f"- {entry.source} -> {entry.target} [{entry.type}, {'locked' if entry.locked else 'open'}]"
                for entry in entries
            )
        else:
            lines.append("(비어 있음)")
        if conflicts:
            lines.append("")
            lines.append("충돌")
            lines.extend(f"- {item.source}: {item.previous} -> {item.suggested}" for item in conflicts)
        self.query_one("#glossary-list", Static).update("\n".join(lines))

    def on_button_pressed(self, event: Button.Pressed) -> None:
        button_id = event.button.id
        if button_id == "back":
            self.push_main()
            return
        source = self.value("source")
        manager = self._manager()
        if not source:
            self.set_status("오류: 원문 용어가 필요합니다.")
            return
        if button_id == "save":
            manager.add_or_update(
                GlossaryEntry(
                    source=source,
                    target=self.value("target") or source,
                    type=self.value("term-type") or "proper_noun",
                    locked=self.checkbox_value("locked"),
                    notes=self.value("notes"),
                    confidence=0.95,
                )
            )
            self.set_status("저장했습니다.")
        elif button_id == "lock":
            self.set_status("잠금 완료" if manager.lock_term(source) else "해당 용어를 찾지 못했습니다.")
        elif button_id == "resolve-new":
            self.set_status("충돌 해결" if manager.resolve_conflict(source, "use_suggested") else "해결할 충돌 없음")
        elif button_id == "resolve-keep":
            self.set_status("충돌 해결" if manager.resolve_conflict(source, "keep_previous") else "해결할 충돌 없음")
        self._refresh()


class SettingsScreen(BaseScreen):
    def compose_body(self) -> ComposeResult:
        config = app_of(self).config
        yield Static("설정", classes="title")
        with Horizontal(classes="row"):
            yield Input(placeholder="프로젝트 기본 디렉터리", id="base-dir", value=config.base_dir)
            yield Input(placeholder="기본 모델", id="default-model", value=config.default_model)
            yield Input(placeholder="기본 동시 화수", id="parallel", value=str(config.default_parallel_episodes))
        with Horizontal(classes="row"):
            yield Select(_backend_options(), id="backend", value=config.default_translation_backend)
            yield Input(placeholder="Codex CLI 명령", id="codex-command", value=config.codex_command)
            yield Input(placeholder="Codex timeout 초", id="codex-timeout", value=str(config.codex_timeout_seconds))
        yield Input(placeholder="워터마크", id="watermark", value=config.watermark)
        with Horizontal(classes="row"):
            yield Input(placeholder="OpenAI 조직 ID", id="org", value=config.openai_organization)
            yield Input(placeholder="OpenAI 프로젝트 ID", id="project", value=config.openai_project)
        with Horizontal(classes="row"):
            yield Input(placeholder="입력 토큰 단가/100만", id="input-price", value=str(config.input_price_per_million_tokens))
            yield Input(placeholder="출력 토큰 단가/100만", id="output-price", value=str(config.output_price_per_million_tokens))
        yield Input(placeholder="사이트 정책 업데이트 HTTPS URL", id="policy-url", value=config.policy_update_url)
        with Horizontal(classes="row"):
            yield Input(placeholder="OpenAI API key 저장/교체", id="api-key", password=True)
            yield Input(placeholder="OpenAI access token 저장/교체", id="access-token", password=True)
        with Horizontal(classes="row"):
            yield Button("설정 저장", id="save", variant="primary")
            yield Button("Codex 상태", id="codex-status")
            yield Button("Codex 로그인", id="codex-login")
            yield Button("API key 삭제", id="clear-api-key")
            yield Button("access token 삭제", id="clear-access-token")
            yield Button("메인으로", id="back")
        yield Static("", id="settings-status")

    def on_button_pressed(self, event: Button.Pressed) -> None:
        button_id = event.button.id
        if button_id == "back":
            self.push_main()
        elif button_id == "save":
            self._save()
        elif button_id == "codex-status":
            codex = CodexCLI(command=self.value("codex-command") or "codex")
            authenticated, detail = codex.login_status()
            self.set_status(
                f"codex_cli={'installed' if codex.is_installed() else 'missing'}\n"
                f"codex_login={'authenticated' if authenticated else 'missing'}\n{detail}",
                "settings-status",
            )
        elif button_id == "codex-login":
            self._codex_login()
        elif button_id == "clear-api-key":
            CredentialStore(app_of(self).config_manager.config_dir).clear_api_key()
            self.set_status("API key를 삭제했습니다.", "settings-status")
        elif button_id == "clear-access-token":
            CredentialStore(app_of(self).config_manager.config_dir).clear_access_token()
            self.set_status("access token을 삭제했습니다.", "settings-status")

    def _save(self) -> None:
        app = app_of(self)
        try:
            app.config.base_dir = self.value("base-dir") or "projects"
            app.config.default_model = self.value("default-model") or "gpt-5.5"
            app.config.default_parallel_episodes = int(self.value("parallel") or "4")
            app.config.default_translation_backend = normalize_translation_backend(self.select_value("backend") or "openai")
            app.config.codex_command = self.value("codex-command") or "codex"
            app.config.codex_timeout_seconds = int(self.value("codex-timeout") or "600")
            app.config.watermark = self.value("watermark")
            app.config.openai_organization = self.value("org")
            app.config.openai_project = self.value("project")
            app.config.input_price_per_million_tokens = float(self.value("input-price") or "0")
            app.config.output_price_per_million_tokens = float(self.value("output-price") or "0")
            app.config.policy_update_url = self.value("policy-url")
            app.save_config()
            store = CredentialStore(app.config_manager.config_dir)
            api_key = self.value("api-key")
            access_token = self.value("access-token")
            if api_key:
                store.set_api_key(api_key)
            if access_token:
                store.set_access_token(access_token)
        except Exception as exc:  # noqa: BLE001
            self.set_status(f"오류: {exc}", "settings-status")
            return
        self.set_status("설정을 저장했습니다.", "settings-status")

    def _codex_login(self) -> None:
        codex = CodexCLI(command=self.value("codex-command") or "codex")
        try:
            ok, detail = codex.login()
        except Exception as exc:  # noqa: BLE001
            self.set_status(f"오류: {exc}", "settings-status")
            return
        self.set_status(f"codex_login={'authenticated' if ok else 'failed'}\n{detail}", "settings-status")


def _backend_options(with_default: bool = False) -> list[tuple[str, BackendValue]]:
    options: list[tuple[str, BackendValue]] = []
    if with_default:
        options.append(("프로젝트 기본값", ""))
    options.extend(
        [
            ("OpenAI API key/access token", "openai"),
            ("Codex CLI 로그인", "codex"),
            ("자동 선택", "auto"),
            ("Dry-run", "dry-run"),
        ]
    )
    return options


def _formats(value: str) -> list[str]:
    return [item.strip() for item in (value or "txt,docx,epub").split(",") if item.strip()]


def _project_label(project: Project) -> str:
    try:
        manifest = project.load_manifest()
        return f"{manifest.name} ({project.root})"
    except Exception:
        return str(project.root)


def run_textual_app() -> int:
    app = NovelTransApp()
    app.run()
    return 0
