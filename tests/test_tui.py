from __future__ import annotations

import asyncio
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

try:
    import textual  # noqa: F401

    TEXTUAL_AVAILABLE = True
except ModuleNotFoundError:
    TEXTUAL_AVAILABLE = False


@unittest.skipUnless(TEXTUAL_AVAILABLE, "Textual is not installed")
class TextualUITests(unittest.TestCase):
    def test_main_menu_and_settings_screen_mount(self) -> None:
        from noveltrans.config import ConfigManager
        from noveltrans.tui import NovelTransApp

        async def run() -> None:
            with tempfile.TemporaryDirectory() as tmp:
                app = NovelTransApp(ConfigManager(Path(tmp)))
                async with app.run_test(size=(120, 80)) as pilot:
                    await pilot.pause()
                    self.assertEqual(type(app.screen).__name__, "MainMenuScreen")
                    await pilot.click("#settings")
                    await pilot.pause()
                    self.assertEqual(type(app.screen).__name__, "SettingsScreen")
                    await pilot.press("m")
                    await pilot.pause()
                    self.assertEqual(type(app.screen).__name__, "MainMenuScreen")

        asyncio.run(run())

    def test_new_project_runner_uses_existing_workflow(self) -> None:
        from noveltrans.models import ExportOptions, ParallelOptions, QualityOptions, TranslationOptions
        from noveltrans.project import ProjectManager
        from noveltrans.tui.app import NewProjectRequest, TranslationRunScreen

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source.txt"
            source.write_text("# 第1話\n本文。", encoding="utf-8")
            request = NewProjectRequest(
                name="tui_demo",
                source_mode="file",
                source=str(source),
                fallback_file="",
                episode_spec="all",
                translation=TranslationOptions(backend="dry-run"),
                parallel=ParallelOptions(max_parallel_episodes=1),
                quality=QualityOptions(),
                export=ExportOptions(formats=["txt"]),
                confirm_rights=True,
                no_redistribute=True,
                allow_auto_fetch=False,
                permission_note="",
            )
            screen = TranslationRunScreen.new_project(request, ProjectManager(root / "projects"))
            project, outputs = screen.runner()
            self.assertTrue((project.translated_dir / "episode_001.ko.md").exists())
            self.assertEqual([path.suffix for path in outputs], [".txt"])

    def test_existing_project_screens_mount(self) -> None:
        from noveltrans.config import ConfigManager
        from noveltrans.models import ExportOptions, ParallelOptions, QualityOptions, TranslationOptions
        from noveltrans.project import ProjectManager
        from noveltrans.tui import NovelTransApp
        from noveltrans.tui.app import ExportScreen, GlossaryScreen, ProjectDashboardScreen
        from noveltrans.workflow import create_project_from_local_file, run_translation_and_export

        async def run() -> None:
            with tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                source = root / "source.txt"
                source.write_text("# 第1話\n本文。", encoding="utf-8")
                manager = ProjectManager(root / "projects")
                project = create_project_from_local_file(
                    manager=manager,
                    name="existing",
                    input_path=source,
                    translation=TranslationOptions(backend="dry-run"),
                    parallel=ParallelOptions(max_parallel_episodes=1),
                    quality=QualityOptions(),
                    export=ExportOptions(formats=["txt"]),
                    episode_spec="all",
                )
                run_translation_and_export(project, backend="dry-run", resume=False)

                config_manager = ConfigManager(root / "config")
                config = config_manager.load()
                config.base_dir = str(root / "projects")
                config_manager.save(config)

                app = NovelTransApp(config_manager)
                async with app.run_test(size=(120, 80)) as pilot:
                    await pilot.pause()
                    app.push_screen(ProjectDashboardScreen(project))
                    await pilot.pause()
                    self.assertEqual(type(app.screen).__name__, "ProjectDashboardScreen")
                    app.push_screen(ExportScreen(project))
                    await pilot.pause()
                    self.assertEqual(type(app.screen).__name__, "ExportScreen")
                    app.push_screen(GlossaryScreen(project))
                    await pilot.pause()
                    self.assertEqual(type(app.screen).__name__, "GlossaryScreen")

        asyncio.run(run())


if __name__ == "__main__":
    unittest.main()
