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

    def test_textual_flag_launches_textual_ui(self) -> None:
        from noveltrans.cli import main

        with patch("noveltrans.cli._run_textual_ui", return_value=79) as textual:
            self.assertEqual(main(["--textual"]), 79)
        textual.assert_called_once_with()


if __name__ == "__main__":
    unittest.main()
