from __future__ import annotations

import sqlite3
import sys
import tempfile
import unittest
import zipfile
import json
import os
from contextlib import redirect_stderr, redirect_stdout
from io import StringIO
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from noveltrans.models import ExportOptions, ParallelOptions, QualityOptions, TranslationOptions
from noveltrans.models import EpisodeMetadata, EpisodeText, Section
from noveltrans.project import ProjectManager
from noveltrans.errors import ConfigurationError, ProjectError, SourceInputError, TranslationError
from noveltrans.exporters import Exporter, normalize_export_formats
from noveltrans.glossary import GlossaryManager
from noveltrans.cli import main
from noveltrans.models import GlossaryEntry, TranslationResult
from noveltrans.progress import format_progress_line, snapshot_project_progress, target_episode_numbers
from noveltrans.translator import Translator
from noveltrans.workflow import (
    add_source_episodes_from_local_file,
    create_project_from_local_file,
    estimate_project_translation,
    _fetch_selected_episodes,
    run_translation_and_export,
)


class WorkflowExportTests(unittest.TestCase):
    def test_local_dry_run_workflow_exports_all_formats(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "novel.txt"
            source.write_text(
                """# 第1話 始まり
王都アルフェンへ向かった。

# 第2話 旅立ち
黒狼騎士団が現れた。レベル12になった。
""",
                encoding="utf-8",
            )
            manager = ProjectManager(root / "projects")
            project = create_project_from_local_file(
                manager=manager,
                name="demo",
                input_path=source,
                translation=TranslationOptions(model="gpt-5.5"),
                parallel=ParallelOptions(max_parallel_episodes=2),
                quality=QualityOptions(),
                export=ExportOptions(formats=["txt", "epub"]),
                episode_spec="all",
            )
            outputs = run_translation_and_export(project, dry_run=True)
            self.assertEqual({path.suffix for path in outputs}, {".txt", ".epub"})
            self.assertTrue((project.translated_dir / "episode_001.ko.md").exists())
            self.assertTrue((project.logs_dir / "episode_001.qa.json").exists())
            self.assertTrue((project.logs_dir / "estimate.json").exists())
            self.assertTrue((project.logs_dir / "quality_report.json").exists())
            quality_text = (project.logs_dir / "quality_report.txt").read_text(encoding="utf-8")
            self.assertIn("NovelTrans Quality Report", quality_text)
            self.assertIn("status_counts", quality_text)

            txt = (project.exports_dir / f"{project.root.name}.txt").read_text(encoding="utf-8")
            self.assertIn("재배포 금지", txt)
            self.assertIn("수집일:", txt)
            self.assertIn("[DRY-RUN KO]", txt)

            with zipfile.ZipFile(project.exports_dir / f"{project.root.name}.epub") as epub:
                names = epub.namelist()
                self.assertEqual(names[0], "mimetype")
                self.assertIn("OEBPS/content.opf", names)
                self.assertIn("OEBPS/title.xhtml", names)
                self.assertIn("OEBPS/chapter_001.xhtml", names)
                content_opf = epub.read("OEBPS/content.opf").decode("utf-8")
                self.assertIn("<dc:source>", content_opf)
                self.assertIn("<dc:rights>", content_opf)
                self.assertIn("<dc:language>ko</dc:language>", content_opf)
                self.assertIn("page-progression-direction=\"ltr\"", content_opf)
                title_page = epub.read("OEBPS/title.xhtml").decode("utf-8")
                self.assertIn("작품 정보", title_page)
                self.assertIn("수집일", title_page)
                chapter = epub.read("OEBPS/chapter_001.xhtml").decode("utf-8")
                self.assertIn("<h1>第1話 始まり [DRY-RUN]</h1>", chapter)
                self.assertNotIn("<p>第1話 始まり [DRY-RUN]</p>", chapter)
                nav = epub.read("OEBPS/nav.xhtml").decode("utf-8")
                self.assertIn("작품 정보", nav)

            with sqlite3.connect(project.root / "project.db") as conn:
                rows = conn.execute("SELECT status, COUNT(*) FROM episodes GROUP BY status").fetchall()
            self.assertEqual(dict(rows).get("completed"), 2)

            second_outputs = run_translation_and_export(project, dry_run=True, resume=True)
            self.assertEqual({path.suffix for path in second_outputs}, {".txt", ".epub"})
            self.assertEqual(estimate_project_translation(project, resume=True).episode_count, 0)
            self.assertEqual(estimate_project_translation(project, resume=True).estimated_total_tokens, 0)

    def test_progress_snapshot_reports_pending_and_completed_ranges(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "progress.txt"
            source.write_text("# 第1話\n本文一。\n\n# 第2話\n本文二。\n\n# 第3話\n本文三。", encoding="utf-8")
            project = create_project_from_local_file(
                manager=ProjectManager(root / "projects"),
                name="progress",
                input_path=source,
                translation=TranslationOptions(model="gpt-5.5"),
                parallel=ParallelOptions(max_parallel_episodes=1),
                quality=QualityOptions(),
                export=ExportOptions(formats=["txt"]),
            )

            targets = target_episode_numbers(project, resume=False)
            snapshot = snapshot_project_progress(project, targets)

            self.assertEqual(targets, [1, 2, 3])
            self.assertEqual(snapshot.pending, [1, 2, 3])
            self.assertIn("대기 1-3", format_progress_line(snapshot))

            run_translation_and_export(project, dry_run=True, resume=False)
            completed = snapshot_project_progress(project, targets)

            self.assertEqual(completed.completed, [1, 2, 3])
            self.assertEqual(target_episode_numbers(project, resume=True), [])

    def test_pending_auto_seeded_glossary_entries_are_not_exported_as_japanese_targets(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "pending_terms.txt"
            source.write_text("# 第1話\n王都アルフェン。王都アルフェン。", encoding="utf-8")
            project = create_project_from_local_file(
                manager=ProjectManager(root / "projects"),
                name="pending_terms",
                input_path=source,
                translation=TranslationOptions(model="gpt-5.5"),
                parallel=ParallelOptions(max_parallel_episodes=1),
                quality=QualityOptions(),
                export=ExportOptions(formats=["txt"]),
            )

            run_translation_and_export(project, dry_run=True, resume=False)
            glossary_text = (project.glossary_dir / "glossary.json").read_text(encoding="utf-8")
            export_text = (project.exports_dir / "pending_terms.txt").read_text(encoding="utf-8")

            self.assertIn('"target": ""', glossary_text)
            self.assertNotIn("王都アルフェン -> 王都アルフェン", export_text)

    def test_run_local_command_uses_codex_backend_without_openai_key(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source.txt"
            source.write_text("# 第1話\n本文。", encoding="utf-8")
            bin_dir = root / "bin"
            bin_dir.mkdir()
            fake_codex = bin_dir / "codex"
            fake_codex.write_text(
                "#!/usr/bin/env python3\n"
                "import json, sys\n"
                "if sys.argv[1:3] == ['login', 'status']:\n"
                "    print('ChatGPT login active')\n"
                "    raise SystemExit(0)\n"
                "if sys.argv[1:3] == ['exec', '-']:\n"
                "    prompt = sys.stdin.read()\n"
                "    assert 'Do not use shell commands' in prompt\n"
                "    print(json.dumps({\n"
                "        'title_ko': '제1화',\n"
                "        'foreword_ko': '',\n"
                "        'body_ko': 'CODEX KO',\n"
                "        'afterword_ko': '',\n"
                "        'new_terms': [],\n"
                "        'term_conflicts': [],\n"
                "        'episode_summary': '요약',\n"
                "        'qa_notes': []\n"
                "    }, ensure_ascii=False))\n"
                "    raise SystemExit(0)\n"
                "print('unexpected codex args: ' + repr(sys.argv), file=sys.stderr)\n"
                "raise SystemExit(2)\n",
                encoding="utf-8",
            )
            os.chmod(fake_codex, 0o755)
            env = {
                "PATH": str(bin_dir) + os.pathsep + os.environ.get("PATH", ""),
                "OPENAI_API_KEY": "",
                "NOVELTRANS_CONFIG_DIR": str(root / "config"),
            }
            output = StringIO()
            with redirect_stdout(output), patch.dict(os.environ, env):
                code = main(
                    [
                        "run-local",
                        "--name",
                        "codex_backend",
                        "--input",
                        str(source),
                        "--base-dir",
                        str(root / "projects"),
                        "--backend",
                        "codex",
                        "--confirm-rights",
                        "--no-redistribute",
                        "--formats",
                        "txt",
                    ]
                )
            self.assertEqual(code, 0)
            project_root = Path([line for line in output.getvalue().splitlines() if line.strip()][0])
            self.assertTrue((project_root / "project.json").exists())
            self.assertFalse((project_root / "project.yaml").exists())
            translated = (project_root / "translated" / "episode_001.ko.md").read_text(encoding="utf-8")
            self.assertIn("CODEX KO", translated)

    def test_hundred_episode_project_resume_path(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "hundred.txt"
            source.write_text(
                "\n\n".join(f"# 第{i}話\n王都アルフェンの記録{i}。" for i in range(1, 101)),
                encoding="utf-8",
            )
            project = create_project_from_local_file(
                manager=ProjectManager(root / "projects"),
                name="hundred",
                input_path=source,
                translation=TranslationOptions(model="gpt-5.5"),
                parallel=ParallelOptions(max_parallel_episodes=4),
                quality=QualityOptions(),
                export=ExportOptions(formats=["txt"]),
                episode_spec="all",
            )
            run_translation_and_export(project, dry_run=True)
            self.assertEqual(len(list(project.translated_dir.glob("episode_*.ko.md"))), 100)
            with sqlite3.connect(project.root / "project.db") as conn:
                rows = conn.execute("SELECT status, COUNT(*) FROM episodes GROUP BY status").fetchall()
            self.assertEqual(dict(rows).get("completed"), 100)

            before = sorted(path.stat().st_mtime_ns for path in project.translated_dir.glob("episode_*.ko.md"))
            run_translation_and_export(project, dry_run=True, resume=True)
            after = sorted(path.stat().st_mtime_ns for path in project.translated_dir.glob("episode_*.ko.md"))
            self.assertEqual(before, after)

    def test_completed_resume_exports_without_requiring_translation_credentials(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "completed.txt"
            source.write_text("# 第1話\n本文。", encoding="utf-8")
            project = create_project_from_local_file(
                manager=ProjectManager(root / "projects"),
                name="completed",
                input_path=source,
                translation=TranslationOptions(model="gpt-5.5"),
                parallel=ParallelOptions(max_parallel_episodes=1),
                quality=QualityOptions(),
                export=ExportOptions(formats=["txt"]),
            )
            run_translation_and_export(project, dry_run=True)
            outputs = run_translation_and_export(project, dry_run=False, resume=True)
            self.assertEqual({path.suffix for path in outputs}, {".txt"})

    def test_existing_project_can_import_new_episodes_and_translate_only_added_items(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            initial = root / "initial.txt"
            initial.write_text("# 第1話\n本文一。\n\n# 第2話\n本文二。", encoding="utf-8")
            project = create_project_from_local_file(
                manager=ProjectManager(root / "projects"),
                name="continue",
                input_path=initial,
                translation=TranslationOptions(model="gpt-5.5"),
                parallel=ParallelOptions(max_parallel_episodes=2),
                quality=QualityOptions(),
                export=ExportOptions(formats=["txt"]),
            )
            run_translation_and_export(project, dry_run=True)
            before = {
                path.name: path.stat().st_mtime_ns
                for path in sorted(project.translated_dir.glob("episode_*.ko.md"))
            }

            update = root / "updated.txt"
            update.write_text(
                "# 第1話\n本文一。\n\n# 第2話\n本文二。\n\n# 第3話\n本文三。",
                encoding="utf-8",
            )
            imported = add_source_episodes_from_local_file(project=project, input_path=update)
            self.assertEqual(imported, [3])
            run_translation_and_export(project, dry_run=True, resume=True)

            after = {
                path.name: path.stat().st_mtime_ns
                for path in sorted(project.translated_dir.glob("episode_*.ko.md"))
            }
            self.assertEqual(before["episode_001.ko.md"], after["episode_001.ko.md"])
            self.assertEqual(before["episode_002.ko.md"], after["episode_002.ko.md"])
            self.assertIn("episode_003.ko.md", after)
            self.assertEqual(estimate_project_translation(project, resume=True).episode_count, 0)

    def test_translation_failures_are_reported(self) -> None:
        class FailingTranslator(Translator):
            def translate_episode(self, episode, options, glossary, previous_summary=""):
                raise RuntimeError("boom")

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "fail.txt"
            source.write_text("# 第1話\n本文。", encoding="utf-8")
            project = create_project_from_local_file(
                manager=ProjectManager(root / "projects"),
                name="fail",
                input_path=source,
                translation=TranslationOptions(model="gpt-5.5"),
                parallel=ParallelOptions(max_parallel_episodes=1, retries=0),
                quality=QualityOptions(),
                export=ExportOptions(formats=["txt"]),
            )
            with self.assertRaises(TranslationError):
                run_translation_and_export(project, translator=FailingTranslator())

    def test_auto_fetch_respects_connector_policy_rate_limit(self) -> None:
        class FakeConnector:
            def fetch_episode(self, episode):
                return EpisodeText(
                    episode_no=episode.episode_no,
                    title=f"第{episode.episode_no}話",
                    sections=[Section(type="body", text="本文。")],
                )

        sleeps: list[float] = []
        with (
            patch("noveltrans.workflow.time.monotonic", side_effect=[1.0, 1.2, 1.3]),
            patch("noveltrans.workflow.time.sleep", lambda seconds: sleeps.append(seconds)),
        ):
            episodes = _fetch_selected_episodes(
                connector=FakeConnector(),
                metadata=[
                    EpisodeMetadata(episode_no=1, title="第1話"),
                    EpisodeMetadata(episode_no=2, title="第2話"),
                ],
                selected={1, 2},
                translation=TranslationOptions(),
                max_rps=0.5,
            )
        self.assertEqual([episode.episode_no for episode in episodes], [1, 2])
        self.assertEqual(len(sleeps), 1)
        self.assertAlmostEqual(sleeps[0], 1.8)

    def test_empty_translation_result_is_reported_as_failure(self) -> None:
        class EmptyTranslator(Translator):
            def translate_episode(self, episode, options, glossary, previous_summary=""):
                return TranslationResult(title_ko="제1화", body_ko="")

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "empty_translation.txt"
            source.write_text("# 第1話\n本文。", encoding="utf-8")
            project = create_project_from_local_file(
                manager=ProjectManager(root / "projects"),
                name="empty_translation",
                input_path=source,
                translation=TranslationOptions(model="gpt-5.5"),
                parallel=ParallelOptions(max_parallel_episodes=1, retries=0),
                quality=QualityOptions(),
                export=ExportOptions(formats=["txt"]),
            )
            with self.assertRaises(TranslationError):
                run_translation_and_export(project, translator=EmptyTranslator())
            self.assertFalse(project.translation_path(1).exists())
            self.assertEqual(project.db.counts_by_status().get("failed"), 1)

    def test_resume_retries_failed_status_even_if_partial_file_exists(self) -> None:
        class FirstEpisodeFailingTranslator(Translator):
            def translate_episode(self, episode, options, glossary, previous_summary=""):
                if episode.episode_no == 1:
                    raise RuntimeError("boom")
                return TranslationResult(title_ko=f"제{episode.episode_no}화", body_ko=f"완료 {episode.episode_no}")

        class GoodTranslator(Translator):
            def translate_episode(self, episode, options, glossary, previous_summary=""):
                return TranslationResult(title_ko=f"제{episode.episode_no}화", body_ko=f"복구 {episode.episode_no}")

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "resume_failed.txt"
            source.write_text("# 第1話\n本文一。\n\n# 第2話\n本文二。", encoding="utf-8")
            project = create_project_from_local_file(
                manager=ProjectManager(root / "projects"),
                name="resume_failed",
                input_path=source,
                translation=TranslationOptions(model="gpt-5.5"),
                parallel=ParallelOptions(max_parallel_episodes=1, retries=0),
                quality=QualityOptions(),
                export=ExportOptions(formats=["txt"]),
            )
            with self.assertRaises(TranslationError):
                run_translation_and_export(project, translator=FirstEpisodeFailingTranslator())
            project.translation_path(1).write_text("# partial\n\n깨진 파일\n", encoding="utf-8")

            run_translation_and_export(project, translator=GoodTranslator(), resume=True)

            self.assertIn("복구 1", project.translation_path(1).read_text(encoding="utf-8"))
            with sqlite3.connect(project.root / "project.db") as conn:
                rows = conn.execute("SELECT status, COUNT(*) FROM episodes GROUP BY status").fetchall()
            self.assertEqual(dict(rows).get("completed"), 2)

    def test_glossary_updates_are_synced_to_sqlite(self) -> None:
        class TermTranslator(Translator):
            def translate_episode(self, episode, options, glossary, previous_summary=""):
                return TranslationResult(
                    title_ko="제1화",
                    body_ko="마도기관",
                    new_terms=[
                        GlossaryEntry(
                            source="魔導機関",
                            target="마도기관",
                            type="organization",
                            reading="まどうきかん",
                            confidence=0.91,
                            aliases=["魔導エンジン"],
                            forbidden_targets=["마도 기관"],
                        )
                    ],
                )

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "terms.txt"
            source.write_text("# 第1話\n魔導機関。", encoding="utf-8")
            project = create_project_from_local_file(
                manager=ProjectManager(root / "projects"),
                name="terms",
                input_path=source,
                translation=TranslationOptions(model="gpt-5.5"),
                parallel=ParallelOptions(max_parallel_episodes=1),
                quality=QualityOptions(),
                export=ExportOptions(formats=["txt"]),
            )
            run_translation_and_export(project, translator=TermTranslator())
            with sqlite3.connect(project.root / "project.db") as conn:
                row = conn.execute(
                    "SELECT target, type, locked, reading, status, aliases, forbidden_targets FROM glossary_entries WHERE source = ?",
                    ("魔導機関",),
                ).fetchone()
            self.assertEqual(row[:5], ("마도기관", "organization", 0, "まどうきかん", "accepted_auto"))
            self.assertIn("魔導エンジン", row[5])
            self.assertIn("마도 기관", row[6])

    def test_glossary_v2_sqlite_schema_contains_audit_tables(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "terms.txt"
            source.write_text("# 第1話\n魔導機関。", encoding="utf-8")
            project = create_project_from_local_file(
                manager=ProjectManager(root / "projects"),
                name="schema_terms",
                input_path=source,
                translation=TranslationOptions(model="gpt-5.5"),
                parallel=ParallelOptions(max_parallel_episodes=1),
                quality=QualityOptions(run_qa_pass=False),
                export=ExportOptions(formats=["txt"]),
            )

            with sqlite3.connect(project.root / "project.db") as conn:
                entry_columns = {
                    row[1]
                    for row in conn.execute("PRAGMA table_info(glossary_entries)").fetchall()
                }
                tables = {
                    row[0]
                    for row in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'").fetchall()
                }

            self.assertIn("source_score", entry_columns)
            self.assertIn("target_score", entry_columns)
            self.assertIn("occurrence_count", entry_columns)
            self.assertIn("last_seen_episode", entry_columns)
            self.assertIn("glossary_occurrences", tables)
            self.assertIn("glossary_decisions", tables)

    def test_parallel_translation_does_not_pass_cross_episode_previous_summary(self) -> None:
        class SummaryRecordingTranslator(Translator):
            def __init__(self) -> None:
                self.seen: list[str] = []

            def translate_episode(self, episode, options, glossary, previous_summary=""):
                self.seen.append(previous_summary)
                return TranslationResult(
                    title_ko=f"제{episode.episode_no}화",
                    body_ko=f"본문 {episode.episode_no}",
                    episode_summary=f"요약 {episode.episode_no}",
                )

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "parallel_summary.txt"
            source.write_text(
                "\n\n".join(f"# 第{i}話\n本文{i}。" for i in range(1, 5)),
                encoding="utf-8",
            )
            project = create_project_from_local_file(
                manager=ProjectManager(root / "projects"),
                name="parallel_summary",
                input_path=source,
                translation=TranslationOptions(model="gpt-5.5"),
                parallel=ParallelOptions(max_parallel_episodes=4),
                quality=QualityOptions(),
                export=ExportOptions(formats=["txt"]),
            )
            translator = SummaryRecordingTranslator()
            run_translation_and_export(project, translator=translator)
            self.assertEqual(translator.seen, ["", "", "", ""])

    def test_sequential_translation_passes_previous_summary(self) -> None:
        class SummaryRecordingTranslator(Translator):
            def __init__(self) -> None:
                self.seen: list[str] = []

            def translate_episode(self, episode, options, glossary, previous_summary=""):
                self.seen.append(previous_summary)
                return TranslationResult(
                    title_ko=f"제{episode.episode_no}화",
                    body_ko=f"본문 {episode.episode_no}",
                    episode_summary=f"요약 {episode.episode_no}",
                )

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "sequential_summary.txt"
            source.write_text("# 第1話\n本文一。\n\n# 第2話\n本文二。", encoding="utf-8")
            project = create_project_from_local_file(
                manager=ProjectManager(root / "projects"),
                name="sequential_summary",
                input_path=source,
                translation=TranslationOptions(model="gpt-5.5"),
                parallel=ParallelOptions(max_parallel_episodes=1),
                quality=QualityOptions(),
                export=ExportOptions(formats=["txt"]),
            )
            translator = SummaryRecordingTranslator()
            run_translation_and_export(project, translator=translator)
            self.assertEqual(translator.seen, ["", "요약 1"])

    def test_episode_scoped_glossary_is_only_injected_for_matching_episode(self) -> None:
        class GlossaryRecordingTranslator(Translator):
            def __init__(self) -> None:
                self.seen: dict[int, list[str]] = {}

            def translate_episode(self, episode, options, glossary, previous_summary=""):
                self.seen[episode.episode_no] = [entry.source for entry in glossary]
                return TranslationResult(title_ko=f"제{episode.episode_no}화", body_ko="본문")

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "scoped_terms.txt"
            source.write_text("# 第1話\n王都アルフェン。\n\n# 第2話\n王都アルフェン。", encoding="utf-8")
            project = create_project_from_local_file(
                manager=ProjectManager(root / "projects"),
                name="scoped_terms",
                input_path=source,
                translation=TranslationOptions(model="gpt-5.5"),
                parallel=ParallelOptions(max_parallel_episodes=1),
                quality=QualityOptions(run_qa_pass=False),
                export=ExportOptions(formats=["txt"]),
            )
            GlossaryManager(project.glossary_dir).add_or_update(
                GlossaryEntry(
                    source="王都アルフェン",
                    target="왕도 알펜",
                    episode_start=2,
                    episode_end=2,
                )
            )
            translator = GlossaryRecordingTranslator()
            run_translation_and_export(project, translator=translator)

            self.assertNotIn("王都アルフェン", translator.seen[1])
            self.assertIn("王都アルフェン", translator.seen[2])

    def test_quality_report_includes_global_term_consistency_issues(self) -> None:
        class InconsistentTranslator(Translator):
            def translate_episode(self, episode, options, glossary, previous_summary=""):
                if episode.episode_no == 1:
                    return TranslationResult(
                        title_ko="제1화",
                        body_ko="기관",
                        new_terms=[GlossaryEntry(source="魔導機関", target="마도기관", confidence=0.9)],
                    )
                return TranslationResult(title_ko="제2화", body_ko="기관")

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "global_terms.txt"
            source.write_text("# 第1話\n魔導機関。\n\n# 第2話\n魔導機関。", encoding="utf-8")
            project = create_project_from_local_file(
                manager=ProjectManager(root / "projects"),
                name="global_terms",
                input_path=source,
                translation=TranslationOptions(model="gpt-5.5"),
                parallel=ParallelOptions(max_parallel_episodes=1),
                quality=QualityOptions(run_term_consistency_pass=True),
                export=ExportOptions(formats=["txt"]),
            )
            run_translation_and_export(project, translator=InconsistentTranslator())
            report = json.loads((project.logs_dir / "quality_report.json").read_text(encoding="utf-8"))
            self.assertTrue(report["global_term_issues"])
            self.assertEqual(report["global_term_issues"][0]["target"], "마도기관")

    def test_global_term_consistency_uses_matching_policy(self) -> None:
        class SpacedTranslator(Translator):
            def translate_episode(self, episode, options, glossary, previous_summary=""):
                return TranslationResult(title_ko=f"제{episode.episode_no}화", body_ko="마도 기관")

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "global_terms_spacing.txt"
            source.write_text("# 第1話\n魔導機関。\n\n# 第2話\n魔導機関。", encoding="utf-8")
            project = create_project_from_local_file(
                manager=ProjectManager(root / "projects"),
                name="global_terms_spacing",
                input_path=source,
                translation=TranslationOptions(model="gpt-5.5"),
                parallel=ParallelOptions(max_parallel_episodes=1),
                quality=QualityOptions(run_term_consistency_pass=True),
                export=ExportOptions(formats=["txt"]),
            )
            GlossaryManager(project.glossary_dir).add_or_update(
                GlossaryEntry(
                    source="魔導機関",
                    target="마도기관",
                    status="accepted_auto",
                    confidence=0.9,
                    matching_policy="spacing_flexible",
                )
            )
            run_translation_and_export(project, translator=SpacedTranslator())
            report = json.loads((project.logs_dir / "quality_report.json").read_text(encoding="utf-8"))
            self.assertEqual(report["global_term_issues"], [])

    def test_unresolved_glossary_conflicts_are_reported_in_exports_and_quality_report(self) -> None:
        class ConflictTranslator(Translator):
            def translate_episode(self, episode, options, glossary, previous_summary=""):
                if episode.episode_no == 1:
                    return TranslationResult(
                        title_ko="제1화",
                        body_ko="왕도 알펜",
                        new_terms=[GlossaryEntry(source="王都アルフェン", target="왕도 알펜", confidence=0.9)],
                    )
                return TranslationResult(
                    title_ko="제2화",
                    body_ko="알펜 왕도",
                    new_terms=[GlossaryEntry(source="王都アルフェン", target="알펜 왕도", confidence=0.95)],
                )

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "term_conflict.txt"
            source.write_text("# 第1話\n王都アルフェン。\n\n# 第2話\n王都アルフェン。", encoding="utf-8")
            project = create_project_from_local_file(
                manager=ProjectManager(root / "projects"),
                name="term_conflict",
                input_path=source,
                translation=TranslationOptions(model="gpt-5.5"),
                parallel=ParallelOptions(max_parallel_episodes=1),
                quality=QualityOptions(run_term_consistency_pass=True),
                export=ExportOptions(formats=["txt", "epub"]),
            )
            run_translation_and_export(project, translator=ConflictTranslator())

            txt = (project.exports_dir / "term_conflict.txt").read_text(encoding="utf-8")
            self.assertIn("미해결 용어 충돌", txt)
            self.assertIn("王都アルフェン", txt)
            self.assertIn("알펜 왕도", txt)

            report = json.loads((project.logs_dir / "quality_report.json").read_text(encoding="utf-8"))
            self.assertEqual(report["unresolved_term_conflicts"][0]["source"], "王都アルフェン")
            quality_text = (project.logs_dir / "quality_report.txt").read_text(encoding="utf-8")
            self.assertIn("Unresolved Term Conflicts", quality_text)

            with zipfile.ZipFile(project.exports_dir / "term_conflict.epub") as epub:
                glossary = epub.read("OEBPS/glossary.xhtml").decode("utf-8")
            self.assertIn("미해결 용어 충돌", glossary)
            self.assertIn("王都アルフェン", glossary)

    def test_exports_can_exclude_author_notes(self) -> None:
        class AfterwordTranslator(Translator):
            def translate_episode(self, episode, options, glossary, previous_summary=""):
                return TranslationResult(
                    title_ko="제1화",
                    body_ko="본문 번역",
                    afterword_ko="작가 후기 내용",
                    episode_summary="요약",
                    qa_notes=["메모"],
                )

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "note.txt"
            source.write_text("# 第1話\n本文。", encoding="utf-8")
            project = create_project_from_local_file(
                manager=ProjectManager(root / "projects"),
                name="note",
                input_path=source,
                translation=TranslationOptions(model="gpt-5.5"),
                parallel=ParallelOptions(max_parallel_episodes=1, retries=0),
                quality=QualityOptions(),
                export=ExportOptions(formats=["txt", "epub"], include_author_notes=False),
            )
            run_translation_and_export(project, translator=AfterwordTranslator())

            txt = (project.exports_dir / f"{project.root.name}.txt").read_text(encoding="utf-8")
            self.assertIn("본문 번역", txt)
            self.assertIn("번역 메모", txt)
            self.assertNotIn("작가 후기 내용", txt)

    def test_translation_option_suppresses_author_notes_even_if_backend_returns_them(self) -> None:
        class AfterwordTranslator(Translator):
            def translate_episode(self, episode, options, glossary, previous_summary=""):
                return TranslationResult(title_ko="제1화", body_ko="본문 번역", afterword_ko="반환된 후기")

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "translate_note.txt"
            source.write_text("# 第1話\n## 本文\n本文。\n## あとがき\nあとがき。", encoding="utf-8")
            project = create_project_from_local_file(
                manager=ProjectManager(root / "projects"),
                name="translate_note",
                input_path=source,
                translation=TranslationOptions(model="gpt-5.5", translate_author_notes=False),
                parallel=ParallelOptions(max_parallel_episodes=1),
                quality=QualityOptions(),
                export=ExportOptions(formats=["txt"], include_author_notes=True),
            )
            run_translation_and_export(project, translator=AfterwordTranslator())
            self.assertNotIn("반환된 후기", project.translation_path(1).read_text(encoding="utf-8"))

    def test_saved_translation_separates_foreword_body_and_afterword(self) -> None:
        class SectionTranslator(Translator):
            def translate_episode(self, episode, options, glossary, previous_summary=""):
                return TranslationResult(
                    title_ko="제1화",
                    foreword_ko="전서 번역",
                    body_ko="본문 번역",
                    afterword_ko="후기 번역",
                )

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "sections.txt"
            source.write_text("# 第1話\n本文。", encoding="utf-8")
            project = create_project_from_local_file(
                manager=ProjectManager(root / "projects"),
                name="sections",
                input_path=source,
                translation=TranslationOptions(model="gpt-5.5"),
                parallel=ParallelOptions(max_parallel_episodes=1),
                quality=QualityOptions(),
                export=ExportOptions(formats=["txt", "epub"]),
            )
            run_translation_and_export(project, translator=SectionTranslator())
            text = project.translation_path(1).read_text(encoding="utf-8")
            self.assertIn("## 전서", text)
            self.assertIn("## 본문", text)
            self.assertIn("## 후기", text)
            self.assertLess(text.index("## 전서"), text.index("## 본문"))
            self.assertLess(text.index("## 본문"), text.index("## 후기"))
            with zipfile.ZipFile(project.exports_dir / f"{project.root.name}.epub") as epub:
                chapter = epub.read("OEBPS/chapter_001.xhtml").decode("utf-8")
            self.assertIn('<h2 class="section-title">전서</h2>', chapter)
            self.assertIn('<h2 class="section-title">본문</h2>', chapter)
            self.assertIn('<h2 class="section-title">후기</h2>', chapter)

    def test_split_long_episode_translates_chunks_and_merges_result(self) -> None:
        class ChunkTranslator(Translator):
            def __init__(self) -> None:
                self.calls: list[str] = []

            def translate_episode(self, episode, options, glossary, previous_summary=""):
                self.calls.append(episode.title)
                return TranslationResult(
                    title_ko="긴 화",
                    body_ko=f"chunk:{episode.metadata.get('chunk_index')}:{len(episode.all_text())}",
                    episode_summary=f"summary {episode.metadata.get('chunk_index')}",
                )

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "long.txt"
            source.write_text("# 第1話\n" + ("あ" * 800) + "\n\n" + ("い" * 800), encoding="utf-8")
            project = create_project_from_local_file(
                manager=ProjectManager(root / "projects"),
                name="long",
                input_path=source,
                translation=TranslationOptions(model="gpt-5.5"),
                parallel=ParallelOptions(max_parallel_episodes=1, split_long_episode=True, long_episode_threshold_chars=1000),
                quality=QualityOptions(),
                export=ExportOptions(formats=["txt"]),
            )
            translator = ChunkTranslator()
            run_translation_and_export(project, translator=translator)
            translated = project.translation_path(1).read_text(encoding="utf-8")
            self.assertEqual(len(translator.calls), 2)
            self.assertIn("chunk:1:800", translated)
            self.assertIn("chunk:2:800", translated)
            self.assertIn("long episode split into 2 chunk(s)", translated)

    def test_unknown_export_format_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "bad_format.txt"
            source.write_text("# 第1話\n本文。", encoding="utf-8")
            project = create_project_from_local_file(
                manager=ProjectManager(root / "projects"),
                name="bad_format",
                input_path=source,
                translation=TranslationOptions(model="gpt-5.5"),
                parallel=ParallelOptions(max_parallel_episodes=1),
                quality=QualityOptions(),
                export=ExportOptions(formats=["txt", "pdf"]),
            )
            with self.assertRaises(ConfigurationError):
                run_translation_and_export(project, dry_run=True)
            self.assertFalse((project.translated_dir / "episode_001.ko.md").exists())

    def test_docx_export_format_is_rejected_for_explicit_requests(self) -> None:
        with self.assertRaises(ConfigurationError) as context:
            normalize_export_formats(["txt", "docx"])
        self.assertIn("DOCX 출력은 제거", str(context.exception))

    def test_export_without_translated_chapters_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "not_translated.txt"
            source.write_text("# 第1話\n本文。", encoding="utf-8")
            project = create_project_from_local_file(
                manager=ProjectManager(root / "projects"),
                name="not_translated",
                input_path=source,
                translation=TranslationOptions(model="gpt-5.5"),
                parallel=ParallelOptions(),
                quality=QualityOptions(),
                export=ExportOptions(formats=["txt"]),
            )
            with self.assertRaises(ProjectError):
                Exporter().export(project)

    def test_export_ignores_translation_files_for_incomplete_db_status(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "partial.txt"
            source.write_text("# 第1話\n本文。", encoding="utf-8")
            project = create_project_from_local_file(
                manager=ProjectManager(root / "projects"),
                name="partial",
                input_path=source,
                translation=TranslationOptions(model="gpt-5.5"),
                parallel=ParallelOptions(),
                quality=QualityOptions(),
                export=ExportOptions(formats=["txt"]),
            )
            project.translation_path(1).write_text("# partial\n\n미완료", encoding="utf-8")
            with self.assertRaises(ProjectError):
                Exporter().export(project)

    def test_empty_source_file_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "empty.txt"
            source.write_text("", encoding="utf-8")
            with self.assertRaises(SourceInputError):
                create_project_from_local_file(
                    manager=ProjectManager(root / "projects"),
                    name="empty",
                    input_path=source,
                    translation=TranslationOptions(model="gpt-5.5"),
                    parallel=ParallelOptions(),
                    quality=QualityOptions(),
                    export=ExportOptions(formats=["txt"]),
                )

    def test_zip_without_supported_sources_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "empty.zip"
            with zipfile.ZipFile(source, "w") as archive:
                archive.writestr("image.bin", b"")
            with self.assertRaises(SourceInputError):
                create_project_from_local_file(
                    manager=ProjectManager(root / "projects"),
                    name="empty_zip",
                    input_path=source,
                    translation=TranslationOptions(model="gpt-5.5"),
                    parallel=ParallelOptions(),
                    quality=QualityOptions(),
                    export=ExportOptions(formats=["txt"]),
                )

    def test_run_url_command_uses_restricted_url_with_user_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            fallback = root / "saved.txt"
            fallback.write_text("# 第1話\n本文一。\n\n# 第2話\n本文二。", encoding="utf-8")
            output = StringIO()
            with redirect_stdout(output):
                code = main(
                    [
                        "run-url",
                        "--name",
                        "url_demo",
                        "--url",
                        "https://kakuyomu.jp/works/abc",
                        "--fallback-file",
                        str(fallback),
                        "--base-dir",
                        str(root / "projects"),
                        "--episodes",
                        "2",
                        "--dry-run",
                        "--confirm-rights",
                        "--no-redistribute",
                        "--formats",
                        "txt,epub",
                    ]
                )
            self.assertEqual(code, 0)
            lines = [line for line in output.getvalue().splitlines() if line.strip()]
            project_root = Path(lines[0])
            self.assertTrue((project_root / "exports" / "url_demo.txt").exists())
            self.assertTrue((project_root / "exports" / "url_demo.epub").exists())
            self.assertFalse((project_root / "translated" / "episode_001.ko.md").exists())
            self.assertTrue((project_root / "translated" / "episode_002.ko.md").exists())

    def test_run_url_command_can_auto_fetch_kakuyomu_public_episode(self) -> None:
        import noveltrans.connectors.kakuyomu as kakuyomu

        work_url = "https://kakuyomu.jp/works/111"
        episode_url = "https://kakuyomu.jp/works/111/episodes/222"
        state = {
            "Work:111": {
                "__typename": "Work",
                "id": "111",
                "title": "公開作品",
                "author": {"__ref": "UserAccount:7"},
                "publicEpisodeCount": 1,
                "serialStatus": "RUNNING",
                "tableOfContentsV2": [{"__ref": "TableOfContentsChapter:"}],
            },
            "UserAccount:7": {"__typename": "UserAccount", "activityName": "作者"},
            "TableOfContentsChapter:": {
                "__typename": "TableOfContentsChapter",
                "episodeUnions": [{"__ref": "Episode:222"}],
            },
            "Episode:222": {"__typename": "Episode", "id": "222", "title": "第1話 公開話"},
        }
        next_data = json.dumps(
            {"props": {"pageProps": {"__APOLLO_STATE__": state}}},
            ensure_ascii=False,
        )
        work_html = f'<script id="__NEXT_DATA__" type="application/json">{next_data}</script>'
        episode_html = """
        <p class="widget-episodeTitle">第1話 公開話</p>
        <div class="widget-episodeBody js-episode-body">
          <p id="p1">公開本文。</p>
        </div>
        """

        class FakeHeaders:
            def get_content_charset(self):
                return "utf-8"

        class FakeResponse:
            headers = FakeHeaders()

            def __init__(self, text: str) -> None:
                self.text = text

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

            def read(self):
                return self.text.encode("utf-8")

        def fake_urlopen(request, timeout=30):
            return FakeResponse(episode_html if request.full_url == episode_url else work_html)

        original = kakuyomu.urllib.request.urlopen
        kakuyomu.urllib.request.urlopen = fake_urlopen  # type: ignore[assignment]
        try:
            with tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                output = StringIO()
                with redirect_stdout(output):
                    code = main(
                        [
                            "run-url",
                            "--name",
                            "kakuyomu_public",
                            "--url",
                            work_url,
                            "--base-dir",
                            str(root / "projects"),
                            "--episodes",
                            "1",
                            "--dry-run",
                            "--allow-auto-fetch",
                            "--permission-note",
                            "authorized personal use",
                            "--confirm-rights",
                            "--no-redistribute",
                            "--formats",
                            "txt",
                        ]
                    )
                self.assertEqual(code, 0)
                project_root = Path([line for line in output.getvalue().splitlines() if line.strip()][0])
                self.assertTrue((project_root / "source" / "episode_001.json").exists())
                self.assertTrue((project_root / "translated" / "episode_001.ko.md").exists())
                self.assertTrue((project_root / "exports" / "kakuyomu_public.txt").exists())
        finally:
            kakuyomu.urllib.request.urlopen = original  # type: ignore[assignment]

    def test_run_url_command_can_select_original_episode_number_from_user_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            fallback = root / "saved_episode_12.txt"
            fallback.write_text("# 第12話 遠征\n本文十二。", encoding="utf-8")
            output = StringIO()
            with redirect_stdout(output):
                code = main(
                    [
                        "run-url",
                        "--name",
                        "url_episode_number",
                        "--url",
                        "https://kakuyomu.jp/works/abc/episodes/12",
                        "--fallback-file",
                        str(fallback),
                        "--base-dir",
                        str(root / "projects"),
                        "--episodes",
                        "12",
                        "--dry-run",
                        "--confirm-rights",
                        "--no-redistribute",
                        "--formats",
                        "txt",
                    ]
                )
            self.assertEqual(code, 0)
            project_root = Path([line for line in output.getvalue().splitlines() if line.strip()][0])
            self.assertFalse((project_root / "translated" / "episode_001.ko.md").exists())
            self.assertTrue((project_root / "translated" / "episode_012.ko.md").exists())

    def test_run_local_rejects_invalid_parallel_value(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source.txt"
            source.write_text("# 第1話\n本文。", encoding="utf-8")
            error = StringIO()
            with redirect_stderr(error):
                code = main(
                    [
                        "run-local",
                        "--name",
                        "bad_parallel",
                        "--input",
                        str(source),
                        "--base-dir",
                        str(root / "projects"),
                        "--parallel",
                        "0",
                        "--dry-run",
                    ]
                )
            self.assertEqual(code, 1)
            self.assertIn("동시 번역 화수", error.getvalue())

    def test_noninteractive_source_commands_require_rights_confirmations(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source.txt"
            source.write_text("# 第1話\n本文。", encoding="utf-8")
            error = StringIO()
            with redirect_stderr(error):
                code = main(
                    [
                        "run-local",
                        "--name",
                        "missing_rights",
                        "--input",
                        str(source),
                        "--base-dir",
                        str(root / "projects"),
                        "--dry-run",
                    ]
                )
            self.assertEqual(code, 1)
            self.assertIn("--confirm-rights", error.getvalue())

            error = StringIO()
            with redirect_stderr(error):
                code = main(
                    [
                        "run-url",
                        "--name",
                        "missing_url_rights",
                        "--url",
                        "https://kakuyomu.jp/works/abc",
                        "--fallback-file",
                        str(source),
                        "--base-dir",
                        str(root / "projects"),
                        "--dry-run",
                    ]
                )
            self.assertEqual(code, 1)
            self.assertIn("--no-redistribute", error.getvalue())

    def test_add_source_command_can_import_and_translate_added_episode(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            initial = root / "initial.txt"
            initial.write_text("# 第1話\n本文一。", encoding="utf-8")
            output = StringIO()
            with redirect_stdout(output):
                code = main(
                    [
                        "run-local",
                        "--name",
                        "cmd_continue",
                        "--input",
                        str(initial),
                        "--base-dir",
                        str(root / "projects"),
                        "--dry-run",
                        "--confirm-rights",
                        "--no-redistribute",
                        "--formats",
                        "txt",
                    ]
                )
            self.assertEqual(code, 0)
            project_root = Path([line for line in output.getvalue().splitlines() if line.strip()][0])

            update = root / "updated.txt"
            update.write_text("# 第1話\n本文一。\n\n# 第2話\n本文二。", encoding="utf-8")
            output = StringIO()
            with redirect_stdout(output):
                code = main(
                    [
                        "add-source",
                        "--project",
                        str(project_root),
                        "--input",
                        str(update),
                        "--base-dir",
                        str(root / "projects"),
                        "--translate",
                        "--dry-run",
                        "--confirm-rights",
                        "--no-redistribute",
                        "--formats",
                        "txt",
                    ]
                )
            self.assertEqual(code, 0)
            self.assertIn("imported=2", output.getvalue())
            self.assertTrue((project_root / "translated" / "episode_002.ko.md").exists())

    def test_export_command_regenerates_selected_formats(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source.txt"
            source.write_text("# 第1話\n本文。", encoding="utf-8")
            output = StringIO()
            with redirect_stdout(output):
                code = main(
                    [
                        "run-local",
                        "--name",
                        "export_cmd",
                        "--input",
                        str(source),
                        "--base-dir",
                        str(root / "projects"),
                        "--dry-run",
                        "--confirm-rights",
                        "--no-redistribute",
                        "--formats",
                        "txt",
                    ]
                )
            self.assertEqual(code, 0)
            project_root = Path([line for line in output.getvalue().splitlines() if line.strip()][0])
            (project_root / "exports" / "export_cmd.txt").unlink()

            output = StringIO()
            with redirect_stdout(output):
                code = main(
                    [
                        "export",
                        "--project",
                        str(project_root),
                        "--base-dir",
                        str(root / "projects"),
                        "--formats",
                        "txt,epub",
                    ]
                )
            self.assertEqual(code, 0)
            self.assertTrue((project_root / "exports" / "export_cmd.txt").exists())
            self.assertTrue((project_root / "exports" / "export_cmd.epub").exists())

    def test_verify_command_reports_valid_and_invalid_project_outputs(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "verify.txt"
            source.write_text("# 第1話\n本文。", encoding="utf-8")
            output = StringIO()
            with redirect_stdout(output):
                code = main(
                    [
                        "run-local",
                        "--name",
                        "verify_cmd",
                        "--input",
                        str(source),
                        "--base-dir",
                        str(root / "projects"),
                        "--dry-run",
                        "--confirm-rights",
                        "--no-redistribute",
                        "--formats",
                        "txt,epub",
                    ]
                )
            self.assertEqual(code, 0)
            project_root = Path([line for line in output.getvalue().splitlines() if line.strip()][0])

            output = StringIO()
            with redirect_stdout(output):
                code = main(["verify", "--project", str(project_root), "--base-dir", str(root / "projects")])
            self.assertEqual(code, 0)
            self.assertIn("ok=true", output.getvalue())

            (project_root / "exports" / "verify_cmd.epub").write_text("bad", encoding="utf-8")
            output = StringIO()
            with redirect_stdout(output):
                code = main(["verify", "--project", str(project_root), "--base-dir", str(root / "projects")])
            self.assertEqual(code, 1)
            self.assertIn("ok=false", output.getvalue())
            self.assertIn("export/epub_bad_zip", output.getvalue())

    def test_verify_command_reports_project_state_drift(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "verify_drift.txt"
            source.write_text("# 第1話\n本文。", encoding="utf-8")
            output = StringIO()
            with redirect_stdout(output):
                code = main(
                    [
                        "run-local",
                        "--name",
                        "verify_drift",
                        "--input",
                        str(source),
                        "--base-dir",
                        str(root / "projects"),
                        "--dry-run",
                        "--confirm-rights",
                        "--no-redistribute",
                        "--formats",
                        "txt",
                    ]
                )
            self.assertEqual(code, 0)
            project_root = Path([line for line in output.getvalue().splitlines() if line.strip()][0])
            with sqlite3.connect(project_root / "project.db") as conn:
                work_id = conn.execute("SELECT id FROM works LIMIT 1").fetchone()[0]
                conn.execute("UPDATE episodes SET source_hash = 'stale' WHERE episode_no = 1")
                conn.execute(
                    "INSERT INTO episodes(work_id, episode_no, title, source_hash, status) VALUES (?, ?, ?, ?, ?)",
                    (work_id, 99, "orphan", "hash", "completed"),
                )
            (project_root / "logs" / "episode_001.qa.json").unlink()

            output = StringIO()
            with redirect_stdout(output):
                code = main(["verify", "--project", str(project_root), "--base-dir", str(root / "projects")])
            self.assertEqual(code, 1)
            text = output.getvalue()
            self.assertIn("db/source_hash_mismatch:1", text)
            self.assertIn("db/orphan_episode:99", text)
            self.assertIn("logs/missing_episode_qa:1", text)

    def test_report_command_prints_quality_report_text_and_json(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "report.txt"
            source.write_text("# 第1話\n本文。", encoding="utf-8")
            output = StringIO()
            with redirect_stdout(output):
                code = main(
                    [
                        "run-local",
                        "--name",
                        "report_cmd",
                        "--input",
                        str(source),
                        "--base-dir",
                        str(root / "projects"),
                        "--dry-run",
                        "--confirm-rights",
                        "--no-redistribute",
                        "--formats",
                        "txt",
                    ]
                )
            self.assertEqual(code, 0)
            project_root = Path([line for line in output.getvalue().splitlines() if line.strip()][0])

            output = StringIO()
            with redirect_stdout(output):
                code = main(["report", "--project", str(project_root), "--base-dir", str(root / "projects")])
            self.assertEqual(code, 0)
            self.assertIn("NovelTrans Quality Report", output.getvalue())

            output = StringIO()
            with redirect_stdout(output):
                code = main(["report", "--project", str(project_root), "--base-dir", str(root / "projects"), "--json"])
            self.assertEqual(code, 0)
            self.assertIn('"status_counts"', output.getvalue())

    def test_status_command_shows_completed_failed_and_pending_episode_ranges(self) -> None:
        class FirstEpisodeFailingTranslator(Translator):
            def translate_episode(self, episode, options, glossary, previous_summary=""):
                if episode.episode_no == 1:
                    raise RuntimeError("boom")
                return TranslationResult(title_ko=f"제{episode.episode_no}화", body_ko=f"본문 {episode.episode_no}")

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "status.txt"
            source.write_text("# 第1話\n本文一。\n\n# 第2話\n本文二。\n\n# 第3話\n本文三。", encoding="utf-8")
            project = create_project_from_local_file(
                manager=ProjectManager(root / "projects"),
                name="status_demo",
                input_path=source,
                translation=TranslationOptions(model="gpt-5.5"),
                parallel=ParallelOptions(max_parallel_episodes=1, retries=0),
                quality=QualityOptions(),
                export=ExportOptions(formats=["txt"]),
            )
            with self.assertRaises(TranslationError):
                run_translation_and_export(project, translator=FirstEpisodeFailingTranslator())
            with sqlite3.connect(project.root / "project.db") as conn:
                conn.execute("UPDATE episodes SET status = 'pending' WHERE episode_no = 3")
            project.translation_path(3).unlink()

            output = StringIO()
            with redirect_stdout(output):
                code = main(["status", "--project", str(project.root), "--base-dir", str(root / "projects")])

            self.assertEqual(code, 0)
            text = output.getvalue()
            self.assertIn("project=status_demo", text)
            self.assertIn("- 완료: 2", text)
            self.assertIn("- 실패: 1", text)
            self.assertIn("- 미번역: 3", text)

    def test_estimate_command_reports_pending_and_all_episode_counts(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "estimate.txt"
            source.write_text("# 第1話\n本文一。\n\n# 第2話\n本文二。", encoding="utf-8")
            output = StringIO()
            with redirect_stdout(output):
                code = main(
                    [
                        "run-local",
                        "--name",
                        "estimate_cmd",
                        "--input",
                        str(source),
                        "--base-dir",
                        str(root / "projects"),
                        "--dry-run",
                        "--confirm-rights",
                        "--no-redistribute",
                        "--formats",
                        "txt",
                    ]
                )
            self.assertEqual(code, 0)
            project_root = Path([line for line in output.getvalue().splitlines() if line.strip()][0])

            output = StringIO()
            with redirect_stdout(output):
                code = main(["estimate", "--project", str(project_root), "--base-dir", str(root / "projects")])
            self.assertEqual(code, 0)
            text = output.getvalue()
            self.assertIn("episode_count=0", text)
            self.assertIn("estimated_total_tokens=0", text)

            output = StringIO()
            with redirect_stdout(output):
                code = main(["estimate", "--project", str(project_root), "--base-dir", str(root / "projects"), "--all"])
            self.assertEqual(code, 0)
            text = output.getvalue()
            self.assertIn("episode_count=2", text)
            self.assertIn("model=gpt-5.5", text)
            self.assertIn("pricing_note=", text)


if __name__ == "__main__":
    unittest.main()
