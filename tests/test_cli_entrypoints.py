from __future__ import annotations

import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))


class CLIEntrypointTests(unittest.TestCase):
    def test_default_command_launches_terminal_wizard(self) -> None:
        from noveltrans.cli import main

        with patch("noveltrans.wizard.wizard_main", return_value=77) as wizard:
            self.assertEqual(main([]), 77)
        wizard.assert_called_once_with()

    def test_top_level_help_lists_available_subcommands(self) -> None:
        from noveltrans.cli import main

        output = StringIO()
        with redirect_stdout(output):
            with self.assertRaises(SystemExit) as raised:
                main(["--help"])

        self.assertEqual(raised.exception.code, 0)
        text = output.getvalue()
        for command in ("run-local", "run-url", "add-source", "export", "status", "estimate", "report", "verify", "auth", "policy", "doctor"):
            self.assertIn(command, text)

    def test_subcommand_help_shows_command_options(self) -> None:
        from noveltrans.cli import main

        output = StringIO()
        with redirect_stdout(output):
            with self.assertRaises(SystemExit) as raised:
                main(["run-local", "--help"])

        self.assertEqual(raised.exception.code, 0)
        text = output.getvalue()
        self.assertIn("--confirm-rights", text)
        self.assertIn("--no-redistribute", text)
        self.assertIn("--backend", text)

    def test_wizard_back_key_is_user_facing_navigation(self) -> None:
        from noveltrans.wizard import BackRequested, Choice, TerminalPrompt

        prompt = TerminalPrompt()
        prompt.interactive = False
        with patch("builtins.input", side_effect=["b"]):
            with self.assertRaises(BackRequested):
                prompt.select("선택", [Choice("하나", "one")])

    def test_new_project_draft_uses_settings_defaults(self) -> None:
        from noveltrans.config import AppConfig
        from noveltrans.wizard import _new_project_draft_from_config

        draft = _new_project_draft_from_config(
            AppConfig(
                default_model="custom-model",
                default_translation_backend="codex",
                default_parallel_episodes=2,
                default_source_mode="file",
                default_episode_spec="1-3",
                default_translation_preset="literal",
                default_output_formats=["txt"],
                default_run_qa_pass=False,
                watermark="wm",
            )
        )

        self.assertEqual(draft.translation.model, "custom-model")
        self.assertEqual(draft.translation.backend, "codex")
        self.assertEqual(draft.translation.preset, "literal")
        self.assertEqual(draft.source_mode, "file")
        self.assertEqual(draft.episode_spec, "1-3")
        self.assertEqual(draft.parallel.max_parallel_episodes, 2)
        self.assertEqual(draft.export.formats, ["txt"])
        self.assertFalse(draft.quality.run_qa_pass)
        self.assertEqual(draft.export.watermark, "wm")

    def test_wizard_blocked_url_goes_to_user_provided_source_flow(self) -> None:
        from noveltrans.config import AppConfig
        from noveltrans.wizard import TerminalPrompt, _collect_new_project_source, _new_project_draft_from_config

        prompt = TerminalPrompt()
        prompt.interactive = False
        draft = _new_project_draft_from_config(AppConfig())
        draft.source_mode = "url"
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "saved.txt"
            source.write_text("本文。", encoding="utf-8")
            with patch("builtins.input", side_effect=["https://ncode.syosetu.com/n0000aa/", "", str(source)]):
                _collect_new_project_source(prompt, draft, AppConfig())

        self.assertFalse(draft.allow_auto_fetch)
        self.assertEqual(draft.fallback_file, source)
        self.assertIn("자동 본문 수집 금지", draft.policy_summary)
        self.assertIn("가능 작업", draft.policy_summary)

    def test_wizard_allowed_url_records_auto_fetch_permission_note(self) -> None:
        from noveltrans.config import AppConfig
        from noveltrans.wizard import TerminalPrompt, _collect_new_project_source, _new_project_draft_from_config

        prompt = TerminalPrompt()
        prompt.interactive = False
        config = AppConfig(default_permission_note="public domain status checked")
        draft = _new_project_draft_from_config(config)
        draft.source_mode = "url"
        with patch("builtins.input", side_effect=["https://www.aozora.gr.jp/cards/000148/files/789_14547.html"]):
            _collect_new_project_source(prompt, draft, config)

        self.assertTrue(draft.allow_auto_fetch)
        self.assertIsNone(draft.fallback_file)
        self.assertEqual(draft.permission_note, "public domain status checked")

    def test_new_project_start_uses_settings_defaults_without_extra_option_prompts(self) -> None:
        from noveltrans.config import AppConfig
        from noveltrans.project import ProjectManager
        from noveltrans.wizard import TerminalPrompt, _new_project_wizard

        prompt = TerminalPrompt()
        prompt.interactive = False
        config = AppConfig(
            default_source_mode="file",
            prompt_source_mode_on_start=False,
            show_new_project_review=False,
            default_output_formats=["txt"],
        )
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source.txt"
            source.write_text("# 第1話\n本文。", encoding="utf-8")
            fake_project = object()
            with (
                patch("builtins.input", side_effect=["quick", str(source), ""]),
                patch("noveltrans.wizard.create_project_from_local_file", return_value=fake_project) as create_project,
                patch("noveltrans.wizard._run_project_translation") as run_translation,
            ):
                _new_project_wizard(prompt, ProjectManager(root / "projects"), config)

        create_project.assert_called_once()
        run_translation.assert_called_once_with(prompt, fake_project, "openai", resume=False, confirm_start=False)


if __name__ == "__main__":
    unittest.main()
