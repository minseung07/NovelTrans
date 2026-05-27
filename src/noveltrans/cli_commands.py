"""Non-interactive NovelTrans CLI commands."""

from __future__ import annotations

import argparse
import getpass
import platform
import sys
import webbrowser
from pathlib import Path

from . import __version__
from .config import AppConfig, ConfigManager, CredentialStore
from .connectors import get_connectors
from .exporters import Exporter
from .models import ExportOptions, ParallelOptions, QualityOptions, TranslationOptions
from .policy import PolicyEngine
from .policy_registry import PolicyRegistry
from .project import ProjectManager
from .status import project_status_lines
from .translator import CodexCLI, normalize_translation_backend
from .verify import verify_project
from .workflow import (
    add_source_episodes_from_local_file,
    create_project_from_local_file,
    create_project_from_url,
    estimate_project_translation,
    run_translation_and_export,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="noveltrans",
        description="NovelTrans CLI",
    )
    parser.add_argument("--version", action="store_true", help="print version and exit")
    subparsers = parser.add_subparsers(dest="command", metavar="command")

    wizard_parser = subparsers.add_parser("wizard", help="launch the interactive terminal wizard")
    wizard_parser.set_defaults(handler=_wizard_command)

    run_local = subparsers.add_parser("run-local", help="run a local-file translation workflow")
    run_local.add_argument("--name", required=True)
    run_local.add_argument("--input", required=True)
    run_local.add_argument("--base-dir", default="projects")
    run_local.add_argument("--episodes", default="all")
    run_local.add_argument("--formats", default="txt,epub")
    run_local.add_argument("--model", default="gpt-5.5")
    run_local.add_argument("--parallel", type=int, default=4)
    run_local.add_argument("--backend", default="openai", help="translation backend: openai, codex, auto, or dry-run")
    run_local.add_argument("--dry-run", action="store_true")
    _add_rights_confirmation_args(run_local)
    run_local.set_defaults(handler=run_local_command)

    run_url = subparsers.add_parser("run-url", help="run a URL-based translation workflow")
    run_url.add_argument("--name", required=True)
    run_url.add_argument("--url", required=True)
    run_url.add_argument("--fallback-file", default="")
    run_url.add_argument("--base-dir", default="projects")
    run_url.add_argument("--episodes", default="all")
    run_url.add_argument("--formats", default="txt,epub")
    run_url.add_argument("--model", default="gpt-5.5")
    run_url.add_argument("--parallel", type=int, default=4)
    run_url.add_argument("--backend", default="openai", help="translation backend: openai, codex, auto, or dry-run")
    run_url.add_argument("--dry-run", action="store_true")
    run_url.add_argument("--allow-auto-fetch", action="store_true")
    run_url.add_argument("--permission-note", default="", help="rights/API/permission note for policy audit")
    _add_rights_confirmation_args(run_url)
    run_url.set_defaults(handler=run_url_command)

    add_source = subparsers.add_parser("add-source", help="add local source episodes to an existing project")
    add_source.add_argument("--project", required=True, help="project slug or project path")
    add_source.add_argument("--input", required=True)
    add_source.add_argument("--base-dir", default="projects")
    add_source.add_argument("--episodes", default="all")
    add_source.add_argument("--replace-existing", action="store_true")
    add_source.add_argument("--translate", action="store_true", help="translate pending/failed episodes after import")
    add_source.add_argument("--formats", default="")
    add_source.add_argument("--backend", default="", help="override translation backend: openai, codex, auto, or dry-run")
    add_source.add_argument("--dry-run", action="store_true")
    _add_rights_confirmation_args(add_source)
    add_source.set_defaults(handler=add_source_command)

    export = subparsers.add_parser("export", help="regenerate exports for an existing project")
    export.add_argument("--project", required=True, help="project slug or project path")
    export.add_argument("--base-dir", default="projects")
    export.add_argument("--formats", default="txt,epub")
    export.set_defaults(handler=export_project_command)

    status = subparsers.add_parser("status", help="show status for an existing project")
    status.add_argument("--project", required=True, help="project slug or project path")
    status.add_argument("--base-dir", default="projects")
    status.set_defaults(handler=status_project_command)

    estimate = subparsers.add_parser("estimate", help="estimate pending project translation tokens and cost")
    estimate.add_argument("--project", required=True, help="project slug or project path")
    estimate.add_argument("--base-dir", default="projects")
    estimate.add_argument("--all", action="store_true", help="estimate all source episodes, including completed ones")
    estimate.set_defaults(handler=estimate_project_command)

    report = subparsers.add_parser("report", help="print a project's generated quality report")
    report.add_argument("--project", required=True, help="project slug or project path")
    report.add_argument("--base-dir", default="projects")
    report.add_argument("--json", action="store_true", help="print logs/quality_report.json instead of text")
    report.set_defaults(handler=report_project_command)

    verify = subparsers.add_parser("verify", help="verify project translations, exports, logs, and DB status")
    verify.add_argument("--project", required=True, help="project slug or project path")
    verify.add_argument("--base-dir", default="projects")
    verify.add_argument("--formats", default="", help="optional comma-separated export formats to verify")
    verify.set_defaults(handler=verify_project_command)

    _add_auth_parser(subparsers)
    _add_policy_parser(subparsers)

    doctor = subparsers.add_parser("doctor", help="check NovelTrans runtime configuration")
    doctor.add_argument("--config-dir", default="")
    doctor.add_argument("--base-dir", default="")
    doctor.add_argument("--backend", default="", help="override default backend for this check")
    doctor.add_argument("--strict", action="store_true", help="return non-zero when real translation prerequisites are missing")
    doctor.set_defaults(handler=doctor_command)

    return parser


def _add_auth_parser(subparsers) -> None:
    auth = subparsers.add_parser("auth", help="manage OpenAI and Codex credentials")
    auth_subparsers = auth.add_subparsers(dest="auth_command", metavar="auth-command", required=True)

    status_parser = auth_subparsers.add_parser("status", help="show whether credentials are configured")
    status_parser.add_argument("--config-dir", default="")

    set_key_parser = auth_subparsers.add_parser("set-api-key", help="store an OpenAI API key")
    set_key_parser.add_argument("--config-dir", default="")
    set_key_parser.add_argument("--from-stdin", action="store_true")

    login_parser = auth_subparsers.add_parser("login", help="open OpenAI API key settings and store a key")
    login_parser.add_argument("--config-dir", default="")
    login_parser.add_argument("--from-stdin", action="store_true")
    login_parser.add_argument("--no-browser", action="store_true")

    set_token_parser = auth_subparsers.add_parser("set-access-token", help="store an OAuth/Bearer access token")
    set_token_parser.add_argument("--config-dir", default="")
    set_token_parser.add_argument("--from-stdin", action="store_true")

    clear_key_parser = auth_subparsers.add_parser("clear-api-key", help="remove the stored API key")
    clear_key_parser.add_argument("--config-dir", default="")

    clear_token_parser = auth_subparsers.add_parser("clear-access-token", help="remove the stored access token")
    clear_token_parser.add_argument("--config-dir", default="")

    codex_status_parser = auth_subparsers.add_parser("codex-status", help="show Codex CLI authentication status")
    codex_status_parser.add_argument("--command", dest="codex_command", default="codex")

    codex_login_parser = auth_subparsers.add_parser("codex-login", help="run `codex login` for ChatGPT OAuth")
    codex_login_parser.add_argument("--command", dest="codex_command", default="codex")
    codex_login_parser.add_argument("--device-auth", action="store_true")

    auth.set_defaults(handler=auth_command)


def _add_policy_parser(subparsers) -> None:
    policy = subparsers.add_parser("policy", help="inspect and update site collection policies")
    policy_subparsers = policy.add_subparsers(dest="policy_command", metavar="policy-command", required=True)

    import_parser = policy_subparsers.add_parser("import", help="import policy updates from a JSON file or HTTPS URL")
    import_parser.add_argument("--config-dir", default="")
    import_parser.add_argument("--save-url", action="store_true", help="remember --url for later policy refresh")
    source_group = import_parser.add_mutually_exclusive_group(required=True)
    source_group.add_argument("--file", default="")
    source_group.add_argument("--url", default="")

    refresh_parser = policy_subparsers.add_parser("refresh", help="import policies from the configured HTTPS update URL")
    refresh_parser.add_argument("--config-dir", default="")
    refresh_parser.add_argument("--url", default="", help="override and remember this HTTPS update URL")

    show_parser = policy_subparsers.add_parser("show", help="show effective built-in and plugin connector policies")
    show_parser.add_argument("--config-dir", default="")
    show_parser.add_argument("--site", default="", help="filter by site name substring")
    show_parser.add_argument("--no-plugins", action="store_true", help="only show built-in connector policies")
    show_parser.add_argument("--details", action="store_true", help="print full policy guidance")

    policy.set_defaults(handler=policy_command)


def _wizard_command(args: argparse.Namespace) -> int:
    from .wizard import wizard_main

    return wizard_main()


def run_local_command(args: argparse.Namespace) -> int:
    _validate_parallel_arg(args.parallel)
    _assert_usage_confirmed(args.confirm_rights, args.no_redistribute)
    config = AppConfig(base_dir=args.base_dir, default_model=args.model, default_parallel_episodes=args.parallel)
    backend = normalize_translation_backend(args.backend)
    translation = TranslationOptions(model=args.model, backend=backend)
    parallel = ParallelOptions(max_parallel_episodes=args.parallel)
    quality = QualityOptions()
    export = ExportOptions(formats=_parse_formats(args.formats))
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


def run_url_command(args: argparse.Namespace) -> int:
    _validate_parallel_arg(args.parallel)
    _assert_usage_confirmed(args.confirm_rights, args.no_redistribute)
    config = AppConfig(base_dir=args.base_dir, default_model=args.model, default_parallel_episodes=args.parallel)
    backend = normalize_translation_backend(args.backend)
    translation = TranslationOptions(model=args.model, backend=backend)
    parallel = ParallelOptions(max_parallel_episodes=args.parallel)
    quality = QualityOptions()
    export = ExportOptions(formats=_parse_formats(args.formats))
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


def add_source_command(args: argparse.Namespace) -> int:
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
        outputs = run_translation_and_export(
            project,
            dry_run=args.dry_run,
            formats=_parse_formats(args.formats) if args.formats else None,
            resume=True,
            backend=args.backend or None,
        )
        for output in outputs:
            print(output)
    return 0


def export_project_command(args: argparse.Namespace) -> int:
    project = ProjectManager(args.base_dir).get_project(args.project)
    outputs = Exporter().export(project, formats=_parse_formats(args.formats))
    print(project.root)
    for output in outputs:
        print(output)
    return 0


def status_project_command(args: argparse.Namespace) -> int:
    project = ProjectManager(args.base_dir).get_project(args.project)
    manifest = project.load_manifest()
    print(project.root)
    print(f"project={manifest.name}")
    for line in project_status_lines(project):
        print(line)
    return 0


def estimate_project_command(args: argparse.Namespace) -> int:
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


def report_project_command(args: argparse.Namespace) -> int:
    project = ProjectManager(args.base_dir).get_project(args.project)
    path = project.logs_dir / ("quality_report.json" if args.json else "quality_report.txt")
    if not path.exists():
        from .errors import NovelTransError

        raise NovelTransError(f"품질 리포트가 없습니다: {path}")
    print(path.read_text(encoding="utf-8").rstrip())
    return 0


def verify_project_command(args: argparse.Namespace) -> int:
    project = ProjectManager(args.base_dir).get_project(args.project)
    formats = _parse_formats(args.formats) if args.formats else None
    report = verify_project(project, formats=formats)
    print(project.root)
    print(f"ok={str(report.ok).lower()}")
    for item in report.checked:
        print(f"checked={item}")
    for issue in report.issues:
        print(f"issue={issue}")
    return 0 if report.ok else 1


def auth_command(args: argparse.Namespace) -> int:
    raw_config_dir = getattr(args, "config_dir", "")
    config_dir = Path(raw_config_dir).expanduser() if raw_config_dir else None
    store = CredentialStore(config_dir)
    if args.auth_command == "status":
        print(f"api_key={'set' if store.get_api_key() else 'missing'}")
        print(f"access_token={'set' if store.get_access_token() else 'missing'}")
        return 0
    if args.auth_command == "set-api-key":
        secret = _read_secret("OpenAI API key", from_stdin=args.from_stdin)
        backend = store.set_api_key(secret)
        print(f"api_key={backend}")
        return 0
    if args.auth_command == "login":
        _open_auth_page(open_browser=not args.no_browser)
        secret = _read_secret("OpenAI API key", from_stdin=args.from_stdin)
        backend = store.set_api_key(secret)
        print(f"api_key={backend}")
        return 0
    if args.auth_command == "set-access-token":
        secret = _read_secret("OpenAI access token", from_stdin=args.from_stdin)
        backend = store.set_access_token(secret)
        print(f"access_token={backend}")
        return 0
    if args.auth_command == "clear-api-key":
        store.clear_api_key()
        print("api_key=cleared")
        return 0
    if args.auth_command == "clear-access-token":
        store.clear_access_token()
        print("access_token=cleared")
        return 0
    if args.auth_command == "codex-status":
        codex = CodexCLI(command=args.codex_command)
        authenticated, detail = codex.login_status()
        print(f"codex_cli={'installed' if codex.is_installed() else 'missing'}")
        print(f"codex_login={'authenticated' if authenticated else 'missing'}")
        if detail:
            print(f"detail={detail}")
        return 0 if authenticated else 1
    if args.auth_command == "codex-login":
        codex = CodexCLI(command=args.codex_command)
        ok, detail = codex.login(device_auth=args.device_auth)
        print(f"codex_login={'authenticated' if ok else 'failed'}")
        print(f"detail={detail}")
        return 0 if ok else 1
    return 1


def policy_command(args: argparse.Namespace) -> int:
    registry = _policy_registry_for_config_dir(args.config_dir)
    if args.policy_command == "import":
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
    if args.policy_command == "refresh":
        config_manager = _config_manager_for_config_dir(args.config_dir)
        config = config_manager.load()
        if args.url:
            config.policy_update_url = args.url
            config_manager.save(config)
        if not config.policy_update_url.strip():
            from .errors import ConfigurationError

            raise ConfigurationError("정책 업데이트 URL이 설정되어 있지 않습니다.")
        count = registry.import_url(config.policy_update_url)
        print(f"refreshed={count}")
        print(f"url={config.policy_update_url}")
        return 0
    if args.policy_command == "show":
        engine = PolicyEngine(registry)
        filter_text = args.site.strip().lower()
        for connector in get_connectors(include_plugins=not args.no_plugins):
            policy = engine.effective_policy(connector.get_policy())
            if filter_text and filter_text not in policy.site_name.lower():
                continue
            status = "auto_fetch=allowed" if policy.auto_fetch_allowed else "auto_fetch=blocked"
            if args.details:
                print(engine.describe(policy))
                print()
            else:
                modes = ",".join(policy.allowed_input_modes)
                print(f"{policy.site_name}\tgrade={policy.grade}\t{status}\tinputs={modes}\t{policy.notes}")
        return 0
    return 1


def doctor_command(args: argparse.Namespace) -> int:
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
    from .errors import PolicyViolation

    raise PolicyViolation("비대화형 실행에는 --confirm-rights 와 --no-redistribute 확인이 모두 필요합니다.")


def _parse_formats(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


def _policy_registry_for_config_dir(config_dir: str) -> PolicyRegistry:
    if config_dir:
        return PolicyRegistry(Path(config_dir).expanduser() / "policies.json")
    return PolicyRegistry()


def _config_manager_for_config_dir(config_dir: str) -> ConfigManager:
    if config_dir:
        return ConfigManager(Path(config_dir).expanduser())
    return ConfigManager()


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
        from .errors import ConfigurationError

        raise ConfigurationError("동시 번역 화수는 1부터 8 사이여야 합니다.")
