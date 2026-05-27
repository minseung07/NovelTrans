from __future__ import annotations

import sqlite3
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from io import StringIO
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from noveltrans.cli import main
from noveltrans.errors import ConfigurationError, PolicyViolation
from noveltrans.models import ExportOptions, ParallelOptions, QualityOptions, TranslationOptions
from noveltrans.policy import PolicyEngine
from noveltrans.policy_registry import PolicyRegistry
from noveltrans.project import ProjectManager
from noveltrans.workflow import create_project_from_url
import noveltrans.policy_registry as policy_registry_module


class PolicyRegistryAndUrlFallbackTests(unittest.TestCase):
    def test_policy_registry_can_disable_builtin_auto_fetch(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            registry = PolicyRegistry(Path(tmp) / "policies.json")
            count = registry.import_payload(
                {
                    "version": 1,
                    "policies": {
                        "青空文庫": {
                            "site_name": "青空文庫",
                            "grade": "C",
                            "auto_fetch_allowed": False,
                            "requires_user_permission": True,
                            "notes": "temporarily disabled",
                        }
                    },
                }
            )
            self.assertEqual(count, 1)
            from noveltrans.connectors.aozora import AozoraConnector

            policy = AozoraConnector().get_policy()
            effective = PolicyEngine(registry).effective_policy(policy)
            self.assertFalse(effective.auto_fetch_allowed)
            self.assertEqual(effective.grade, "C")
            with self.assertRaises(PolicyViolation):
                PolicyEngine(registry).assert_can_auto_fetch(policy, user_permission=True)

    def test_policy_registry_url_import_requires_https(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            registry = PolicyRegistry(Path(tmp) / "policies.json")
            with self.assertRaises(ConfigurationError):
                registry.import_url("http://example.com/policies.json")

    def test_malformed_policy_registry_and_import_are_user_facing_errors(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "policies.json"
            path.write_text("{bad json", encoding="utf-8")
            registry = PolicyRegistry(path)
            with self.assertRaises(ConfigurationError):
                registry.load()
            path.write_text('"bad"', encoding="utf-8")
            with self.assertRaises(ConfigurationError):
                registry.load()
            update = Path(tmp) / "update.json"
            update.write_text("{bad json", encoding="utf-8")
            with self.assertRaises(ConfigurationError):
                registry.import_file(update)
            update.write_text('"bad"', encoding="utf-8")
            with self.assertRaises(ConfigurationError):
                registry.import_file(update)
            update.write_text(
                '{"policies": {"青空文庫": {"auto_fetch_allowed": "false"}}}',
                encoding="utf-8",
            )
            with self.assertRaises(ConfigurationError):
                registry.import_file(update)
            update.write_text(
                '{"policies": {"青空文庫": {"grade": "Z"}}}',
                encoding="utf-8",
            )
            with self.assertRaises(ConfigurationError):
                registry.import_file(update)

    def test_policy_cli_imports_and_shows_effective_policy(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            update = root / "policy_update.json"
            update.write_text(
                """
{
  "version": 1,
  "policies": {
    "青空文庫": {
      "site_name": "青空文庫",
      "grade": "C",
      "auto_fetch_allowed": false,
      "requires_user_permission": true,
      "notes": "disabled from cli test"
    }
  }
}
""",
                encoding="utf-8",
            )
            output = StringIO()
            with redirect_stdout(output):
                code = main(["policy", "import", "--config-dir", str(root), "--file", str(update)])
            self.assertEqual(code, 0)
            self.assertIn("imported=1", output.getvalue())

            output = StringIO()
            with redirect_stdout(output):
                code = main(["policy", "show", "--config-dir", str(root), "--site", "青空"])
            self.assertEqual(code, 0)
            self.assertIn("grade=C", output.getvalue())
            self.assertIn("auto_fetch=blocked", output.getvalue())
            self.assertIn("disabled from cli test", output.getvalue())

            output = StringIO()
            with redirect_stdout(output):
                code = main(["policy", "show", "--config-dir", str(root), "--site", "青空", "--details"])
            self.assertEqual(code, 0)
            self.assertIn("가능 작업", output.getvalue())

    def test_policy_cli_refresh_uses_saved_https_url(self) -> None:
        class FakeResponse:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

            def read(self):
                return b"""
{
  "version": 1,
  "policies": {
    "\xe9\x9d\x92\xe7\xa9\xba\xe6\x96\x87\xe5\xba\xab": {
      "site_name": "\xe9\x9d\x92\xe7\xa9\xba\xe6\x96\x87\xe5\xba\xab",
      "grade": "C",
      "auto_fetch_allowed": false,
      "notes": "refreshed policy"
    }
  }
}
"""

        captured_urls: list[str] = []

        def fake_urlopen(request, timeout=30):
            captured_urls.append(request.full_url)
            return FakeResponse()

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            original = policy_registry_module.urllib.request.urlopen
            policy_registry_module.urllib.request.urlopen = fake_urlopen  # type: ignore[assignment]
            try:
                output = StringIO()
                with redirect_stdout(output):
                    code = main(
                        [
                            "policy",
                            "refresh",
                            "--config-dir",
                            str(root),
                            "--url",
                            "https://example.com/policies.json",
                        ]
                    )
                self.assertEqual(code, 0)
                self.assertIn("refreshed=1", output.getvalue())
                self.assertEqual(captured_urls, ["https://example.com/policies.json"])

                output = StringIO()
                with redirect_stdout(output):
                    code = main(["policy", "refresh", "--config-dir", str(root)])
                self.assertEqual(code, 0)
                self.assertEqual(captured_urls[-1], "https://example.com/policies.json")

                output = StringIO()
                with redirect_stdout(output):
                    code = main(["policy", "show", "--config-dir", str(root), "--site", "青空"])
                self.assertEqual(code, 0)
                self.assertIn("refreshed policy", output.getvalue())
            finally:
                policy_registry_module.urllib.request.urlopen = original  # type: ignore[assignment]

    def test_policy_cli_refresh_requires_configured_url(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            output = StringIO()
            error = StringIO()
            with redirect_stdout(output), redirect_stderr(error):
                code = main(["policy", "refresh", "--config-dir", tmp])
            self.assertEqual(code, 1)
            self.assertIn("정책 업데이트 URL", error.getvalue())

    def test_restricted_url_with_user_file_preserves_site_work(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "kakuyomu_saved.txt"
            source.write_text("# 第1話\n本文。\n\n# 第2話\n本文二。", encoding="utf-8")
            project = create_project_from_url(
                manager=ProjectManager(root / "projects"),
                name="restricted",
                url="https://kakuyomu.jp/works/abc",
                translation=TranslationOptions(),
                parallel=ParallelOptions(),
                quality=QualityOptions(),
                export=ExportOptions(formats=["txt"]),
                fallback_file=source,
            )
            manifest = project.load_manifest()
            self.assertEqual(manifest.work.site, "kakuyomu")
            self.assertEqual(manifest.source_policy.site_name, "カクヨム")
            with sqlite3.connect(project.root / "project.db") as conn:
                works = conn.execute("SELECT site, source_url FROM works").fetchall()
                episodes = conn.execute("SELECT COUNT(*) FROM episodes").fetchone()[0]
            self.assertEqual(works, [("kakuyomu", "https://kakuyomu.jp/works/abc")])
            self.assertEqual(episodes, 2)

    def test_specific_syosetu_episode_url_maps_unnumbered_fallback_file(self) -> None:
        import noveltrans.connectors.syosetu as syosetu

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "saved.txt"
            source.write_text("本文だけを保存したファイルです。", encoding="utf-8")
            original = syosetu.urllib.request.urlopen
            syosetu.urllib.request.urlopen = lambda request, timeout=20: (_ for _ in ()).throw(OSError("offline"))  # type: ignore[assignment]
            try:
                project = create_project_from_url(
                    manager=ProjectManager(root / "projects"),
                    name="syosetu_episode",
                    url="https://ncode.syosetu.com/n0000aa/12/",
                    translation=TranslationOptions(),
                    parallel=ParallelOptions(),
                    quality=QualityOptions(),
                    export=ExportOptions(formats=["txt"]),
                    fallback_file=source,
                    episode_spec="12",
                )
            finally:
                syosetu.urllib.request.urlopen = original  # type: ignore[assignment]
            self.assertTrue((project.source_dir / "episode_012.json").exists())
            self.assertEqual(project.load_source_episode(12).metadata["mapped_from_url_episode_no"], 12)

    def test_restricted_single_unmarked_fallback_file_can_use_requested_episode_spec(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "saved_single.txt"
            source.write_text("保存した単独エピソード本文です。", encoding="utf-8")
            project = create_project_from_url(
                manager=ProjectManager(root / "projects"),
                name="restricted_single",
                url="https://kakuyomu.jp/works/abc",
                translation=TranslationOptions(),
                parallel=ParallelOptions(),
                quality=QualityOptions(),
                export=ExportOptions(formats=["txt"]),
                fallback_file=source,
                episode_spec="12",
            )
            self.assertTrue((project.source_dir / "episode_012.json").exists())
            self.assertFalse((project.source_dir / "episode_001.json").exists())
            self.assertEqual(project.load_source_episode(12).metadata["mapped_from_url_episode_no"], 12)
            self.assertEqual(project.load_source_episode(12).metadata["paragraphs"][0]["id"], "e012-body-001")


if __name__ == "__main__":
    unittest.main()
