from __future__ import annotations

import sys
import tempfile
import unittest
import os
import json
from contextlib import redirect_stdout, redirect_stderr
from io import StringIO
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from noveltrans.config import AppConfig, ConfigManager, CredentialStore
import noveltrans.cli_commands as cli_commands_module
from noveltrans.cli import main
from noveltrans.estimate import estimate_translation
from noveltrans.errors import ConfigurationError, TranslationError
from noveltrans.glossary import GlossaryManager
from noveltrans.models import EpisodeText, ExportOptions, GlossaryEntry, GlossaryProposal, ParallelOptions, QualityOptions, Section
from noveltrans.models import TranslationOptions, WorkMetadata
from noveltrans.project import Project, ProjectManager
from noveltrans.prompts import build_episode_payload
from noveltrans.qa import QAEngine
from noveltrans.translator import CodexCLI, CodexTranslator, DryRunTranslator, OpenAITranslator
from noveltrans.translator import extract_translation_payload, result_from_payload
from noveltrans.wizard import _capture_editor_text_to_temp_file, _has_openai_credentials


class ConfigGlossaryTranslatorTests(unittest.TestCase):
    def test_config_manager_uses_explicit_dir(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            manager = ConfigManager(Path(tmp))
            config = AppConfig(
                base_dir="custom_projects",
                default_model="gpt-5.5",
                default_translation_backend="codex",
                codex_command="codex-custom",
                codex_timeout_seconds=120,
                default_source_mode="file",
                default_episode_spec="1-5",
                default_translation_preset="glossary",
                default_output_formats=["txt", "epub"],
                default_run_qa_pass=False,
                default_url_collection_mode="user-file",
            )
            manager.save(config)
            loaded = manager.load()
            self.assertEqual(loaded.base_dir, "custom_projects")
            self.assertEqual(loaded.default_translation_backend, "codex")
            self.assertEqual(loaded.codex_command, "codex-custom")
            self.assertEqual(loaded.codex_timeout_seconds, 120)
            self.assertEqual(loaded.default_source_mode, "file")
            self.assertEqual(loaded.default_episode_spec, "1-5")
            self.assertEqual(loaded.default_translation_preset, "glossary")
            self.assertEqual(loaded.default_output_formats, ["txt", "epub"])
            self.assertFalse(loaded.default_run_qa_pass)
            self.assertEqual(loaded.default_url_collection_mode, "user-file")

    def test_malformed_config_file_is_user_facing_error(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            manager = ConfigManager(Path(tmp))
            manager.config_path.write_text("{bad json", encoding="utf-8")
            with self.assertRaises(ConfigurationError):
                manager.load()
            manager.config_path.write_text("[]", encoding="utf-8")
            with self.assertRaises(ConfigurationError):
                manager.load()
            manager.config_path.write_text('{"default_parallel_episodes": "4"}', encoding="utf-8")
            with self.assertRaises(ConfigurationError):
                manager.load()
            manager.config_path.write_text('{"input_price_per_million_tokens": -1}', encoding="utf-8")
            with self.assertRaises(ConfigurationError):
                manager.load()
            manager.config_path.write_text('{"default_translation_backend": "unknown"}', encoding="utf-8")
            with self.assertRaises(ConfigurationError):
                manager.load()
            manager.config_path.write_text('{"default_output_formats": ["txt", "pdf"]}', encoding="utf-8")
            with self.assertRaises(ConfigurationError):
                manager.load()
            manager.config_path.write_text('{"show_new_project_review": "false"}', encoding="utf-8")
            with self.assertRaises(ConfigurationError):
                manager.load()

    def test_config_manager_drops_removed_docx_default_format(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            manager = ConfigManager(Path(tmp))
            manager.config_path.write_text('{"default_output_formats": ["txt", "docx", "epub"]}', encoding="utf-8")
            loaded = manager.load()
            self.assertEqual(loaded.default_output_formats, ["txt", "epub"])

    def test_credential_store_local_encrypted_roundtrip(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = CredentialStore(Path(tmp))
            store._set_keyring = lambda api_key: False  # type: ignore[method-assign]
            store._get_keyring = lambda: ""  # type: ignore[method-assign]
            store._set_keyring_secret = lambda username, secret: False  # type: ignore[method-assign]
            store._get_keyring_secret = lambda username: ""  # type: ignore[method-assign]
            backend = store.set_api_key("sk-test")
            self.assertEqual(backend, "local_encrypted_file")
            self.assertEqual(store.get_api_key(), "sk-test")
            self.assertNotIn("sk-test", store.secret_path.read_text(encoding="utf-8"))
            token_backend = store.set_access_token("oauth-test")
            self.assertEqual(token_backend, "local_encrypted_file")
            self.assertEqual(store.get_access_token(), "oauth-test")
            self.assertNotIn("oauth-test", store.access_token_path.read_text(encoding="utf-8"))

    def test_credential_store_ignores_obviously_malformed_saved_token(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = CredentialStore(Path(tmp))
            store._set_keyring_secret = lambda username, secret: False  # type: ignore[method-assign]
            store._get_keyring_secret = lambda username: ""  # type: ignore[method-assign]
            store._write_local_secret(",", store.access_token_path)

            self.assertEqual(store.get_access_token(), "")

    def test_auth_command_manages_credentials_without_printing_secret(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            config_dir = Path(tmp)
            output = StringIO()
            with redirect_stdout(output), patch("sys.stdin", StringIO("sk-test\n")):
                code = main(["auth", "set-api-key", "--config-dir", str(config_dir), "--from-stdin"])
            self.assertEqual(code, 0)
            self.assertNotIn("sk-test", output.getvalue())

            output = StringIO()
            with redirect_stdout(output):
                code = main(["auth", "status", "--config-dir", str(config_dir)])
            self.assertEqual(code, 0)
            self.assertIn("api_key=set", output.getvalue())

            output = StringIO()
            with redirect_stdout(output):
                code = main(["auth", "clear-api-key", "--config-dir", str(config_dir)])
            self.assertEqual(code, 0)
            self.assertIn("api_key=cleared", output.getvalue())

            output = StringIO()
            with redirect_stdout(output):
                code = main(["auth", "status", "--config-dir", str(config_dir)])
            self.assertEqual(code, 0)
            self.assertIn("api_key=missing", output.getvalue())

    def test_auth_login_opens_key_page_and_stores_secret(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            output = StringIO()
            with (
                redirect_stdout(output),
                patch("sys.stdin", StringIO("sk-login\n")),
                patch.object(CredentialStore, "_set_keyring", lambda self, api_key: False),
                patch.object(CredentialStore, "_get_keyring", lambda self: ""),
                patch.object(cli_commands_module.webbrowser, "open", return_value=True) as open_browser,
            ):
                code = main(["auth", "login", "--config-dir", tmp, "--from-stdin"])
            self.assertEqual(code, 0)
            self.assertNotIn("sk-login", output.getvalue())
            self.assertIn("OpenAI API key", output.getvalue())
            open_browser.assert_called_once()

            output = StringIO()
            with redirect_stdout(output), patch.object(CredentialStore, "_get_keyring", lambda self: ""):
                code = main(["auth", "status", "--config-dir", tmp])
            self.assertEqual(code, 0)
            self.assertIn("api_key=set", output.getvalue())

    def test_auth_command_rejects_empty_stdin_secret(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            error = StringIO()
            with redirect_stderr(error), patch("sys.stdin", StringIO("\n")):
                code = main(["auth", "set-access-token", "--config-dir", tmp, "--from-stdin"])
            self.assertEqual(code, 1)
            self.assertIn("empty", error.getvalue())

            error = StringIO()
            with redirect_stderr(error), patch("sys.stdin", StringIO(",\n")):
                code = main(["auth", "set-access-token", "--config-dir", tmp, "--from-stdin"])
            self.assertEqual(code, 1)
            self.assertIn("malformed", error.getvalue())

    def test_auth_command_reports_codex_status_and_login(self) -> None:
        class FakeCodex:
            def __init__(self, command="codex", timeout=600) -> None:
                self.command = command

            def is_installed(self) -> bool:
                return True

            def login_status(self):
                return True, "ChatGPT login active"

            def login(self, device_auth: bool = False):
                return True, f"device_auth={device_auth}"

        output = StringIO()
        with redirect_stdout(output), patch.object(cli_commands_module, "CodexCLI", FakeCodex):
            code = main(["auth", "codex-status", "--command", "codex-test"])
        self.assertEqual(code, 0)
        self.assertIn("codex_cli=installed", output.getvalue())
        self.assertIn("codex_login=authenticated", output.getvalue())

        output = StringIO()
        with redirect_stdout(output), patch.object(cli_commands_module, "CodexCLI", FakeCodex):
            code = main(["auth", "codex-login", "--command", "codex-test", "--device-auth"])
        self.assertEqual(code, 0)
        self.assertIn("codex_login=authenticated", output.getvalue())

    def test_project_manifest_uses_json_and_reads_legacy_yaml_name(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manager = ProjectManager(root / "projects")
            project = manager.create_project(
                name="manifest",
                work=WorkMetadata(
                    title="Manifest Test",
                    source_url="local.txt",
                    license_note="user_provided",
                ),
                translation=TranslationOptions(),
                parallel=ParallelOptions(),
                quality=QualityOptions(),
                export=ExportOptions(formats=["txt"]),
                source_policy=None,
            )
            self.assertTrue((project.root / "project.json").exists())
            self.assertFalse((project.root / "project.yaml").exists())

            legacy_root = root / "projects" / "legacy"
            legacy_root.mkdir(parents=True)
            (legacy_root / "project.yaml").write_text(
                (project.root / "project.json").read_text(encoding="utf-8").replace('"slug": "manifest"', '"slug": "legacy"'),
                encoding="utf-8",
            )
            legacy = Project(legacy_root)
            self.assertEqual(legacy.load_manifest().slug, "legacy")
            self.assertEqual([item.root.name for item in manager.list_projects()], ["legacy", "manifest"])

            project.manifest_path.write_text(
                project.manifest_path.read_text(encoding="utf-8").replace('"formats": ["txt"]', '"formats": ["txt", "docx"]'),
                encoding="utf-8",
            )
            self.assertEqual(project.load_manifest().export.formats, ["txt"])

    def test_project_list_is_sorted_by_recent_manifest_update(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manager = ProjectManager(root / "projects")
            old_project = manager.create_project(
                name="old",
                work=WorkMetadata(title="Old", source_url="old.txt", license_note="user_provided"),
                translation=TranslationOptions(),
                parallel=ParallelOptions(),
                quality=QualityOptions(),
                export=ExportOptions(formats=["txt"]),
                source_policy=None,
            )
            new_project = manager.create_project(
                name="new",
                work=WorkMetadata(title="New", source_url="new.txt", license_note="user_provided"),
                translation=TranslationOptions(),
                parallel=ParallelOptions(),
                quality=QualityOptions(),
                export=ExportOptions(formats=["txt"]),
                source_policy=None,
            )
            old_payload = json.loads(old_project.manifest_path.read_text(encoding="utf-8"))
            new_payload = json.loads(new_project.manifest_path.read_text(encoding="utf-8"))
            old_payload["updated_at"] = "2026-05-28T01:00:00+00:00"
            new_payload["updated_at"] = "2026-05-28T02:00:00+00:00"
            old_project.manifest_path.write_text(json.dumps(old_payload, ensure_ascii=False), encoding="utf-8")
            new_project.manifest_path.write_text(json.dumps(new_payload, ensure_ascii=False), encoding="utf-8")

            self.assertEqual([item.root.name for item in manager.list_projects()], ["new", "old"])

    def test_doctor_reports_runtime_configuration(self) -> None:
        class EmptyStore:
            def __init__(self, config_dir=None) -> None:
                pass

            def get_api_key(self) -> str:
                return ""

            def get_access_token(self) -> str:
                return ""

        with tempfile.TemporaryDirectory() as tmp:
            output = StringIO()
            with redirect_stdout(output), patch.object(cli_commands_module, "CredentialStore", EmptyStore):
                code = main(["doctor", "--config-dir", tmp, "--base-dir", str(Path(tmp) / "projects")])
            self.assertEqual(code, 0)
            text = output.getvalue()
            self.assertIn("NovelTrans doctor", text)
            self.assertIn("credentials=missing", text)
            self.assertIn("connectors=", text)
            self.assertIn("warning=real translation requires", text)

    def test_doctor_strict_fails_without_translation_credentials(self) -> None:
        class EmptyStore:
            def __init__(self, config_dir=None) -> None:
                pass

            def get_api_key(self) -> str:
                return ""

            def get_access_token(self) -> str:
                return ""

        with tempfile.TemporaryDirectory() as tmp:
            output = StringIO()
            with redirect_stdout(output), patch.object(cli_commands_module, "CredentialStore", EmptyStore):
                code = main(["doctor", "--config-dir", tmp, "--base-dir", str(Path(tmp) / "projects"), "--strict"])
            self.assertEqual(code, 1)
            self.assertIn("strict_failure=credentials_missing", output.getvalue())

    def test_editor_input_uses_configured_editor(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            script = Path(tmp) / "write_source.py"
            script.write_text(
                "import sys\n"
                "from pathlib import Path\n"
                "Path(sys.argv[1]).write_text('# 第1話\\n本文。', encoding='utf-8')\n",
                encoding="utf-8",
            )
            with patch.dict(os.environ, {"EDITOR": f"{sys.executable} {script}"}):
                path = _capture_editor_text_to_temp_file()
            self.assertIn("本文", path.read_text(encoding="utf-8"))

    def test_cli_accepts_access_token_as_translation_credential(self) -> None:
        class TokenOnlyStore:
            def get_api_key(self):
                return ""

            def get_access_token(self):
                return "oauth-test"

        self.assertTrue(_has_openai_credentials(TokenOnlyStore()))  # type: ignore[arg-type]

    def test_malformed_local_credential_file_is_user_facing_error(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = CredentialStore(Path(tmp))
            store._get_keyring = lambda: ""  # type: ignore[method-assign]
            store.secret_path.write_text("{bad json", encoding="utf-8")
            with self.assertRaises(ConfigurationError):
                store.get_api_key()
            store.secret_path.write_text("[]", encoding="utf-8")
            with self.assertRaises(ConfigurationError):
                store.get_api_key()

    def test_glossary_seed_and_conflict(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            manager = GlossaryManager(Path(tmp))
            episode = EpisodeText(
                episode_no=1,
                title="第1話",
                sections=[Section(type="body", text="王都アルフェン。王都アルフェン。黒狼騎士団。黒狼騎士団。")],
            )
            seeded = manager.seed_from_episodes([episode])
            self.assertTrue(any(entry.source == "王都アルフェン" for entry in seeded))
            self.assertEqual(manager.entries["王都アルフェン"].target, "")
            conflicts = manager.update_from_terms(
                [GlossaryEntry(source="王都アルフェン", target="왕도 알펜", confidence=0.99)]
            )
            self.assertEqual(len(conflicts), 0)
            self.assertEqual(manager.entries["王都アルフェン"].target, "왕도 알펜")
            conflicts = manager.update_from_terms(
                [GlossaryEntry(source="王都アルフェン", target="알펜 왕도", confidence=0.5)]
            )
            self.assertEqual(len(conflicts), 1)
            self.assertTrue(manager.resolve_conflict("王都アルフェン", "use_suggested"))
            self.assertEqual(manager.snapshot()[0].target, "알펜 왕도")
            self.assertEqual(manager.conflict_snapshot(), [])

    def test_glossary_status_aliases_and_forbidden_targets(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            manager = GlossaryManager(Path(tmp))
            manager.add_or_update(
                GlossaryEntry(
                    source="魔導機関",
                    target="",
                    status="pending",
                    aliases=["魔導エンジン", "魔導機関"],
                    forbidden_targets=["마도 기관"],
                )
            )

            entry = manager.entries["魔導機関"]
            self.assertEqual(entry.status, "candidate")
            self.assertEqual(entry.aliases, ["魔導エンジン"])
            self.assertEqual(manager.pending_entries()[0].source, "魔導機関")
            self.assertFalse(manager.lock_term("魔導機関"))

            conflicts = manager.update_from_terms(
                [GlossaryEntry(source="魔導機関", target="마도 기관", confidence=0.99)]
            )
            self.assertEqual(conflicts[-1].recommendation, "keep_previous")
            self.assertEqual(manager.entries["魔導機関"].target, "")

            conflicts = manager.update_from_terms(
                [GlossaryEntry(source="魔導機関", target="마도기관", confidence=0.95)]
            )
            self.assertEqual(conflicts, [])
            self.assertEqual(manager.entries["魔導機関"].status, "accepted_auto")
            self.assertEqual(manager.entries["魔導機関"].target, "마도기관")

            conflicts = manager.update_from_terms(
                [GlossaryEntry(source="魔導機関", target="마도엔진", confidence=0.99)]
            )
            self.assertEqual(conflicts[-1].recommendation, "review")
            self.assertEqual(manager.entries["魔導機関"].status, "needs_review")
            self.assertEqual(manager.entries["魔導機関"].target, "마도기관")

            self.assertTrue(manager.reject_term("魔導機関"))
            self.assertEqual(manager.snapshot(), [])
            self.assertEqual(manager.snapshot(include_inactive=True)[0].status, "forbidden")

    def test_glossary_lock_requires_existing_target(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            manager = GlossaryManager(Path(tmp))
            manager.add_or_update(GlossaryEntry(source="魔導機関", status="candidate"))
            self.assertFalse(manager.lock_term("魔導機関"))

            manager.add_or_update(GlossaryEntry(source="魔導機関", target="마도기관", status="accepted_auto"))
            self.assertTrue(manager.lock_term("魔導機関"))
            self.assertEqual(manager.entries["魔導機関"].status, "locked")

    def test_glossary_proposals_require_source_evidence_and_do_not_overwrite_user_terms(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            manager = GlossaryManager(Path(tmp))
            episode = EpisodeText(
                episode_no=1,
                title="第1話",
                sections=[Section(type="body", text="黒騎士は王都へ向かった。")],
            )
            manager.add_or_update(
                GlossaryEntry(
                    source="黒騎士",
                    target="흑기사",
                    status="accepted_user",
                    origin="user",
                    confidence=1.0,
                )
            )

            conflicts = manager.update_from_terms(
                [
                    GlossaryProposal(
                        source="白騎士",
                        target="백기사",
                        confidence=0.99,
                        reason="not in source",
                    ),
                    GlossaryProposal(
                        source="黒騎士",
                        target="검은 기사",
                        confidence=0.99,
                        reason="alternate target",
                    ),
                ],
                episode=episode,
                strictness="high",
                update_mode="safe",
            )

            self.assertEqual(manager.entries["黒騎士"].target, "흑기사")
            self.assertFalse(any(entry.source == "白騎士" for entry in manager.snapshot(include_inactive=True)))
            self.assertTrue(any(conflict.reason == "user_accepted_conflict" for conflict in conflicts))
            self.assertTrue((Path(tmp) / "proposals.jsonl").exists())
            self.assertIn("source_not_found", (Path(tmp) / "decisions.jsonl").read_text(encoding="utf-8"))

    def test_glossary_safe_merge_promotes_only_empty_candidate_targets(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            manager = GlossaryManager(Path(tmp))
            episode = EpisodeText(
                episode_no=1,
                title="第1話",
                sections=[Section(type="body", text="魔導機関が起動した。")],
            )
            manager.add_or_update(GlossaryEntry(source="魔導機関", status="candidate", source_score=0.82))

            conflicts = manager.update_from_terms(
                [
                    GlossaryProposal(
                        source="魔導機関",
                        target="마도기관",
                        type="organization",
                        confidence=0.91,
                        evidence_quote="魔導機関が起動した",
                        used_in_translation=True,
                    )
                ],
                episode=episode,
                strictness="high",
                update_mode="safe",
            )

            self.assertEqual(conflicts, [])
            self.assertEqual(manager.entries["魔導機関"].status, "accepted_auto")
            self.assertEqual(manager.entries["魔導機関"].target, "마도기관")

    def test_glossary_unsafe_mode_can_replace_auto_terms_but_not_user_terms(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            manager = GlossaryManager(Path(tmp))
            episode = EpisodeText(
                episode_no=1,
                title="第1話",
                sections=[Section(type="body", text="魔導機関と黒騎士。")],
            )
            manager.add_or_update(GlossaryEntry(source="魔導機関", target="마도기관", status="accepted_auto"))
            manager.add_or_update(GlossaryEntry(source="黒騎士", target="흑기사", status="accepted_user", origin="user"))

            conflicts = manager.update_from_terms(
                [
                    GlossaryProposal(source="魔導機関", target="마도 엔진", confidence=0.99),
                    GlossaryProposal(source="黒騎士", target="검은 기사", confidence=0.99),
                ],
                episode=episode,
                strictness="high",
                update_mode="unsafe",
            )

            self.assertEqual(manager.entries["魔導機関"].target, "마도 엔진")
            self.assertEqual(manager.entries["黒騎士"].target, "흑기사")
            self.assertTrue(any(conflict.reason == "user_accepted_conflict" for conflict in conflicts))

    def test_auto_seeded_glossary_terms_are_prompted_as_pending_targets(self) -> None:
        episode = EpisodeText(episode_no=1, title="第1話", sections=[Section(type="body", text="本文。")])
        payload = build_episode_payload(
            episode,
            __import__("noveltrans.models", fromlist=["TranslationOptions"]).TranslationOptions(),
            [
                GlossaryEntry(
                    source="王都アルフェン",
                    target="",
                    confidence=0.7,
                    notes="auto-seeded from repeated source terms",
                )
            ],
        )
        self.assertIn('"target": ""', payload)
        self.assertIn('"status": "candidate"', payload)
        self.assertIn("candidate only", payload)

    def test_prompt_splits_locked_accepted_and_candidate_terms(self) -> None:
        episode = EpisodeText(episode_no=1, title="第1話", sections=[Section(type="body", text="黒騎士。王都。魔導機関。")])
        payload = json.loads(
            build_episode_payload(
                episode,
                TranslationOptions(),
                [
                    GlossaryEntry(source="黒騎士", target="흑기사", status="locked", locked=True),
                    GlossaryEntry(source="王都", target="왕도", status="accepted_auto"),
                    GlossaryEntry(source="魔導機関", target="", status="candidate"),
                ],
            )
        )
        self.assertEqual([item["source"] for item in payload["locked_glossary"]], ["黒騎士"])
        self.assertEqual([item["source"] for item in payload["accepted_glossary"]], ["王都"])
        self.assertEqual([item["source"] for item in payload["candidate_terms"]], ["魔導機関"])
        self.assertNotIn("glossary", payload)

    def test_openai_response_extraction_and_result_parse(self) -> None:
        translator = OpenAITranslator(api_key="sk-test")
        text = translator._extract_text({"output": [{"content": [{"type": "output_text", "text": "{\"title_ko\":\"제목\"}"}]}]})
        self.assertIn("title_ko", text)
        result = result_from_payload(
            {
                "title_ko": "제목",
                "foreword_ko": "",
                "body_ko": "본문",
                "afterword_ko": "",
                "new_terms": [{"source": "魔導機関", "target": "마도기관", "type": "organization", "confidence": 0.9, "reason": "test"}],
                "term_conflicts": [],
                "episode_summary": "요약",
                "qa_notes": ["ok"],
            }
        )
        self.assertEqual(result.new_terms[0].target, "마도기관")

    def test_openai_translator_posts_responses_request_and_parses_result(self) -> None:
        captured: dict[str, object] = {}

        class FakeResponse:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

            def read(self):
                return json.dumps(
                    {
                        "output_text": json.dumps(
                            {
                                "title_ko": "제1화",
                                "foreword_ko": "",
                                "body_ko": "번역문",
                                "afterword_ko": "",
                                "new_terms": [],
                                "term_conflicts": [],
                                "episode_summary": "요약",
                                "qa_notes": [],
                            },
                            ensure_ascii=False,
                        )
                    },
                    ensure_ascii=False,
                ).encode("utf-8")

        def fake_urlopen(request, timeout=0):
            captured["url"] = request.full_url
            captured["timeout"] = timeout
            captured["authorization"] = request.headers.get("Authorization")
            captured["organization"] = request.headers.get("Openai-organization")
            captured["project"] = request.headers.get("Openai-project")
            captured["payload"] = json.loads(request.data.decode("utf-8"))
            return FakeResponse()

        episode = EpisodeText(episode_no=1, title="第1話", sections=[Section(type="body", text="本文。")])
        translator = OpenAITranslator(api_key="sk-test", organization="org-test", project="proj-test")
        with patch("noveltrans.translator.urllib.request.urlopen", fake_urlopen):
            result = translator.translate_episode(episode, __import__("noveltrans.models", fromlist=["TranslationOptions"]).TranslationOptions(), [])

        self.assertEqual(result.body_ko, "번역문")
        self.assertEqual(captured["url"], "https://api.openai.com/v1/responses")
        self.assertEqual(captured["authorization"], "Bearer sk-test")
        self.assertEqual(captured["organization"], "org-test")
        self.assertEqual(captured["project"], "proj-test")
        payload = captured["payload"]
        self.assertEqual(payload["model"], "gpt-5.5")
        self.assertEqual(payload["text"]["format"]["type"], "json_schema")

    def test_codex_translator_parses_cli_output_without_api_key(self) -> None:
        captured: dict[str, str] = {}

        class FakeCodex:
            def exec(self, prompt: str) -> str:
                captured["prompt"] = prompt
                return (
                    "translation follows\n"
                    + json.dumps(
                        {
                            "title_ko": "제1화",
                            "foreword_ko": "",
                            "body_ko": "번역문",
                            "afterword_ko": "",
                            "new_terms": [],
                            "term_conflicts": [],
                            "episode_summary": "요약",
                            "qa_notes": [],
                        },
                        ensure_ascii=False,
                    )
                )

        episode = EpisodeText(episode_no=1, title="第1話", sections=[Section(type="body", text="本文。")])
        result = CodexTranslator(FakeCodex()).translate_episode(  # type: ignore[arg-type]
            episode,
            __import__("noveltrans.models", fromlist=["TranslationOptions"]).TranslationOptions(backend="codex"),
            [],
        )
        self.assertEqual(result.body_ko, "번역문")
        self.assertIn("Do not use shell commands", captured["prompt"])
        self.assertEqual(result.raw_response["backend"], "codex")

    def test_extract_translation_payload_accepts_nested_codex_events(self) -> None:
        payload = {
            "title_ko": "제목",
            "foreword_ko": "",
            "body_ko": "본문",
            "afterword_ko": "",
            "new_terms": [],
            "term_conflicts": [],
            "episode_summary": "",
            "qa_notes": [],
        }
        text = json.dumps({"type": "agent_message", "message": json.dumps(payload, ensure_ascii=False)}, ensure_ascii=False)
        self.assertEqual(extract_translation_payload(text)["body_ko"], "본문")

    def test_openai_result_parse_rejects_non_object_payload(self) -> None:
        with self.assertRaises(TranslationError):
            result_from_payload([])  # type: ignore[arg-type]
        with self.assertRaises(TranslationError):
            result_from_payload({"new_terms": {}, "term_conflicts": []})

    def test_openai_result_parse_treats_null_text_fields_as_empty(self) -> None:
        result = result_from_payload(
            {
                "title_ko": None,
                "foreword_ko": None,
                "body_ko": None,
                "afterword_ko": None,
                "new_terms": [],
                "term_conflicts": [],
                "episode_summary": None,
                "qa_notes": None,
            }
        )
        self.assertEqual(result.body_ko, "")
        self.assertEqual(result.qa_notes, [])

    def test_estimate_can_include_user_configured_cost(self) -> None:
        episode = EpisodeText(episode_no=1, title="第1話", sections=[Section(type="body", text="本文" * 100)])
        estimate = estimate_translation(
            [episode],
            options=__import__("noveltrans.models", fromlist=["TranslationOptions"]).TranslationOptions(),
            input_price_per_million_tokens=1.0,
            output_price_per_million_tokens=2.0,
        )
        self.assertIsNotNone(estimate.estimated_cost)
        self.assertGreater(estimate.estimated_cost or 0, 0)

    def test_dry_run_respects_author_note_translation_option(self) -> None:
        models = __import__("noveltrans.models", fromlist=["TranslationOptions"])
        episode = EpisodeText(
            episode_no=1,
            title="第1話",
            sections=[
                Section(type="body", text="本文。"),
                Section(type="afterword", text="あとがき。"),
            ],
        )
        result = DryRunTranslator().translate_episode(
            episode,
            models.TranslationOptions(translate_author_notes=False),
            [],
        )
        self.assertEqual(result.afterword_ko, "")

    def test_dry_run_preserves_multiple_sections_of_same_type(self) -> None:
        models = __import__("noveltrans.models", fromlist=["TranslationOptions"])
        episode = EpisodeText(
            episode_no=1,
            title="第1話",
            sections=[
                Section(type="body", text="本文一。"),
                Section(type="foreword", text="前書き。"),
                Section(type="body", text="本文二。"),
            ],
        )
        result = DryRunTranslator().translate_episode(episode, models.TranslationOptions(), [])
        self.assertIn("本文一", result.body_ko)
        self.assertIn("本文二", result.body_ko)
        self.assertIn("前書き", result.foreword_ko)

    def test_qa_term_consistency_can_be_disabled(self) -> None:
        source = EpisodeText(episode_no=1, title="第1話", sections=[Section(type="body", text="王都アルフェン。")])
        result = result_from_payload(
            {
                "title_ko": "제1화",
                "foreword_ko": "",
                "body_ko": "왕도.",
                "afterword_ko": "",
                "new_terms": [],
                "term_conflicts": [],
                "episode_summary": "",
                "qa_notes": [],
            }
        )
        issues = QAEngine().run(
            source,
            result,
            [GlossaryEntry(source="王都アルフェン", target="왕도 알펜")],
            check_term_consistency=False,
        )
        self.assertFalse(any(issue.code == "glossary_target_missing" for issue in issues))

    def test_qa_glossary_strictness_controls_checked_entries(self) -> None:
        source = EpisodeText(
            episode_no=1,
            title="第1話",
            sections=[Section(type="body", text="王都アルフェン。黒騎士。")],
        )
        result = result_from_payload(
            {
                "title_ko": "제1화",
                "foreword_ko": "",
                "body_ko": "왕도. 기사.",
                "afterword_ko": "",
                "new_terms": [],
                "term_conflicts": [],
                "episode_summary": "",
                "qa_notes": [],
            }
        )
        glossary = [
            GlossaryEntry(source="王都アルフェン", target="왕도 알펜", status="accepted_auto"),
            GlossaryEntry(source="黒騎士", target="흑기사", status="locked", locked=True),
        ]

        low = QAEngine().run(source, result, glossary, glossary_strictness="low")
        medium = QAEngine().run(source, result, glossary, glossary_strictness="medium")
        high = QAEngine().run(source, result, glossary, glossary_strictness="high")
        strict = QAEngine().run(source, result, glossary, glossary_strictness="strict")

        self.assertFalse(any(issue.code.startswith("glossary_") for issue in low))
        self.assertFalse(any("王都アルフェン" in issue.message for issue in medium))
        self.assertTrue(any(issue.code == "glossary_locked_target_changed" for issue in medium))
        self.assertTrue(any("王都アルフェン" in issue.message for issue in high))
        locked_strict = [issue for issue in strict if issue.code == "glossary_locked_target_changed"]
        self.assertTrue(locked_strict)
        self.assertEqual(locked_strict[0].severity, "warning")

    def test_qa_skips_pending_auto_seeded_glossary_terms(self) -> None:
        source = EpisodeText(episode_no=1, title="第1話", sections=[Section(type="body", text="王都アルフェン。")])
        result = result_from_payload(
            {
                "title_ko": "제1화",
                "foreword_ko": "",
                "body_ko": "왕도 알펜.",
                "afterword_ko": "",
                "new_terms": [],
                "term_conflicts": [],
                "episode_summary": "",
                "qa_notes": [],
            }
        )
        issues = QAEngine().run(
            source,
            result,
            [
                GlossaryEntry(
                    source="王都アルフェン",
                    target="",
                    notes="auto-seeded from repeated source terms",
                )
            ],
        )
        self.assertFalse(any(issue.code == "glossary_target_missing" for issue in issues))

    def test_qa_reports_missing_paragraphs_for_empty_translation(self) -> None:
        source = EpisodeText(episode_no=1, title="第1話", sections=[Section(type="body", text="一。\n\n二。")])
        result = result_from_payload(
            {
                "title_ko": "제1화",
                "foreword_ko": "",
                "body_ko": "",
                "afterword_ko": "",
                "new_terms": [],
                "term_conflicts": [],
                "episode_summary": "",
                "qa_notes": [],
            }
        )
        issues = QAEngine().run(source, result, [])
        self.assertTrue(any(issue.code == "missing_paragraphs" for issue in issues))

    def test_qa_reports_glossary_name_variant_candidates(self) -> None:
        source = EpisodeText(episode_no=1, title="第1話", sections=[Section(type="body", text="アリシア。アリシア。")])
        result = result_from_payload(
            {
                "title_ko": "제1화",
                "foreword_ko": "",
                "body_ko": "알리시아는 앨리시아라고도 불렸다.",
                "afterword_ko": "",
                "new_terms": [],
                "term_conflicts": [],
                "episode_summary": "",
                "qa_notes": [],
            }
        )
        issues = QAEngine().run(
            source,
            result,
            [GlossaryEntry(source="アリシア", target="알리시아", type="person")],
        )
        self.assertTrue(any(issue.code == "glossary_variant_suspected" for issue in issues))

    def test_qa_uses_glossary_aliases_and_forbidden_targets(self) -> None:
        source = EpisodeText(episode_no=1, title="第1話", sections=[Section(type="body", text="魔導エンジンが起動した。")])
        result = result_from_payload(
            {
                "title_ko": "제1화",
                "foreword_ko": "",
                "body_ko": "마도 기관이 기동했다.",
                "afterword_ko": "",
                "new_terms": [],
                "term_conflicts": [],
                "episode_summary": "",
                "qa_notes": [],
            }
        )
        issues = QAEngine().run(
            source,
            result,
            [
                GlossaryEntry(
                    source="魔導機関",
                    target="마도기관",
                    aliases=["魔導エンジン"],
                    forbidden_targets=["마도 기관"],
                )
            ],
        )
        self.assertTrue(any(issue.code == "glossary_target_missing" for issue in issues))
        self.assertTrue(any(issue.code == "glossary_forbidden_target_used" for issue in issues))

    def test_qa_respects_glossary_episode_scope(self) -> None:
        source = EpisodeText(episode_no=1, title="第1話", sections=[Section(type="body", text="王都アルフェン。")])
        result = result_from_payload(
            {
                "title_ko": "제1화",
                "foreword_ko": "",
                "body_ko": "왕도.",
                "afterword_ko": "",
                "new_terms": [],
                "term_conflicts": [],
                "episode_summary": "",
                "qa_notes": [],
            }
        )
        issues = QAEngine().run(
            source,
            result,
            [GlossaryEntry(source="王都アルフェン", target="왕도 알펜", episode_start=2)],
        )
        self.assertFalse(any(issue.code == "glossary_target_missing" for issue in issues))

    def test_qa_reports_contextual_glossary_mismatch(self) -> None:
        source = EpisodeText(episode_no=1, title="第1話", sections=[Section(type="body", text="騎士団長が笑った。")])
        result = result_from_payload(
            {
                "title_ko": "제1화",
                "foreword_ko": "",
                "body_ko": "기사대장이 웃었다.",
                "afterword_ko": "",
                "new_terms": [],
                "term_conflicts": [],
                "episode_summary": "",
                "qa_notes": [],
            }
        )
        issues = QAEngine().run(
            source,
            result,
            [GlossaryEntry(source="騎士団長", target="기사단장", matching_policy="contextual")],
        )
        self.assertTrue(any(issue.code == "glossary_context_mismatch" for issue in issues))

    def test_qa_reports_mixed_speech_style_candidates(self) -> None:
        source = EpisodeText(episode_no=1, title="第1話", sections=[Section(type="body", text="会話。")])
        result = result_from_payload(
            {
                "title_ko": "제1화",
                "foreword_ko": "",
                "body_ko": '"알겠습니다."\n\n"괜찮아요."\n\n"뭐냐?"\n\n"간다."',
                "afterword_ko": "",
                "new_terms": [],
                "term_conflicts": [],
                "episode_summary": "",
                "qa_notes": [],
            }
        )
        issues = QAEngine().run(source, result, [])
        self.assertTrue(any(issue.code == "speech_style_mixed" for issue in issues))


if __name__ == "__main__":
    unittest.main()
