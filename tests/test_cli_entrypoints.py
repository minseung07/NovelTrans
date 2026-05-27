from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))


class CLIEntrypointTests(unittest.TestCase):
    def test_default_command_launches_terminal_wizard(self) -> None:
        from noveltrans.cli import main

        with patch("noveltrans.wizard.wizard_main", return_value=77) as wizard:
            self.assertEqual(main([]), 77)
        wizard.assert_called_once_with()

    def test_classic_flag_launches_legacy_prompt_flow(self) -> None:
        from noveltrans.cli import main

        with patch("noveltrans.cli.interactive_main", return_value=78) as classic:
            self.assertEqual(main(["--classic"]), 78)
        classic.assert_called_once_with()

    def test_classic_helpers_offer_guided_episode_and_format_choices(self) -> None:
        from noveltrans.cli import _choose_episode_spec, _choose_formats

        with patch("builtins.input", side_effect=["3", "2", "6"]):
            self.assertEqual(_choose_episode_spec("번역할 화수 범위"), "2-6")

        with patch("builtins.input", side_effect=["1,3"]):
            self.assertEqual(_choose_formats(), ["txt", "epub"])

    def test_classic_model_choice_can_use_default_without_typing_model_name(self) -> None:
        from noveltrans.cli import _choose_model

        with patch("builtins.input", side_effect=[""]):
            self.assertEqual(_choose_model("gpt-5.5"), "gpt-5.5")

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
                watermark="wm",
            )
        )

        self.assertEqual(draft.translation.model, "custom-model")
        self.assertEqual(draft.translation.backend, "codex")
        self.assertEqual(draft.parallel.max_parallel_episodes, 2)
        self.assertEqual(draft.export.watermark, "wm")


if __name__ == "__main__":
    unittest.main()
