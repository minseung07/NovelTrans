from __future__ import annotations

import json
import sys
import tempfile
import unittest
import zipfile
from io import BytesIO
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from noveltrans.connectors import detect_connector
from noveltrans.connectors.syosetu import SyosetuConnector
from noveltrans.connectors.aozora import AozoraConnector
from noveltrans.errors import EpisodeRangeError, PolicyViolation
from noveltrans.models import ConnectorPolicy, ExportOptions, ParallelOptions, QualityOptions, TranslationOptions
from noveltrans.policy import PolicyEngine
from noveltrans.project import ProjectManager
from noveltrans.preprocessing import html_to_text, split_plain_text
from noveltrans.range_parser import parse_episode_range, parse_single_episode_number
from noveltrans.workflow import create_project_from_local_file, create_project_from_url


class ConnectorPolicyPreprocessingTests(unittest.TestCase):
    def test_episode_range_parser(self) -> None:
        available = list(range(1, 11))
        self.assertEqual(parse_episode_range("1-3,8,10", available), [1, 2, 3, 8, 10])
        self.assertEqual(parse_episode_range("최신 3", available), [8, 9, 10])
        self.assertEqual(parse_episode_range("최신 3화", available), [8, 9, 10])
        self.assertEqual(parse_episode_range("제2화-4화", available), [2, 3, 4])
        self.assertEqual(parse_episode_range("２～４", available), [2, 3, 4])
        self.assertEqual(parse_episode_range("第２話-第４話", available), [2, 3, 4])
        self.assertEqual(parse_episode_range("all", available), available)
        extended = list(range(1, 15))
        self.assertEqual(parse_episode_range("第十二話-第十三話", extended), [12, 13])
        self.assertEqual(parse_episode_range("最新 2話", extended), [13, 14])
        self.assertEqual(parse_episode_range("最新 二話", extended), [13, 14])
        self.assertEqual(parse_single_episode_number("第十二話"), 12)
        self.assertEqual(parse_single_episode_number("１２"), 12)
        self.assertIsNone(parse_single_episode_number("1-3"))
        self.assertIsNone(parse_single_episode_number("最新 1"))
        with self.assertRaises(EpisodeRangeError):
            parse_episode_range("최신 0화", available)
        with self.assertRaises(EpisodeRangeError):
            parse_episode_range("999", available)

    def test_split_plain_text_by_episode_markers(self) -> None:
        text = """# 第1話 始まり
王都アルフェンへ向かった。

# 第2話 旅立ち
黒狼騎士団が現れた。
"""
        episodes = split_plain_text(text)
        self.assertEqual(len(episodes), 2)
        self.assertEqual(episodes[0].title, "第1話 始まり")
        self.assertIn("黒狼騎士団", episodes[1].all_text())

    def test_split_plain_text_accepts_full_width_episode_digits(self) -> None:
        episodes = split_plain_text("第１話 始まり\n本文一。\n\n第２話 続き\n本文二。")
        self.assertEqual(len(episodes), 2)
        self.assertEqual(episodes[0].title, "第１話 始まり")

    def test_split_plain_text_preserves_source_episode_numbers(self) -> None:
        episodes = split_plain_text("# 第12話 始まり\n本文一。\n\n# 第十三話 続き\n本文二。")
        self.assertEqual([episode.episode_no for episode in episodes], [12, 13])

    def test_split_plain_text_extracts_foreword_and_afterword_sections(self) -> None:
        episodes = split_plain_text(
            """# 第1話
## 前書き
前置きです。
## 本文
本文です。
## あとがき
後書きです。
"""
        )
        self.assertEqual([section.type for section in episodes[0].sections], ["foreword", "body", "afterword"])
        self.assertEqual(episodes[0].sections[1].text, "本文です。")

    def test_normalized_project_source_includes_paragraph_ids(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            path = root / "source.txt"
            path.write_text("# 第1話\n## 前書き\n前置き。\n\n## 本文\n一段落。\n\n二段落。", encoding="utf-8")
            project = create_project_from_local_file(
                manager=ProjectManager(root / "projects"),
                name="paragraph_ids",
                input_path=path,
                translation=TranslationOptions(),
                parallel=ParallelOptions(),
                quality=QualityOptions(),
                export=ExportOptions(formats=["txt"]),
            )
            paragraphs = project.load_source_episode(1).metadata["paragraphs"]
        self.assertEqual([item["id"] for item in paragraphs], ["e001-foreword-001", "e001-body-001", "e001-body-002"])
        self.assertTrue(all(item["hash"] for item in paragraphs))

    def test_split_plain_text_does_not_recurse_forever_on_empty_marked_episodes(self) -> None:
        episodes = split_plain_text("# 第1話\n\n# 第2話\n")
        self.assertEqual(len(episodes), 1)
        self.assertEqual(episodes[0].title, "第1話")
        self.assertEqual(episodes[0].all_text(), "")

    def test_html_to_text_skips_scripts(self) -> None:
        text = html_to_text("<html><body><h1>題名</h1><script>x()</script><p>本文</p></body></html>")
        self.assertIn("題名", text)
        self.assertIn("本文", text)
        self.assertNotIn("x()", text)

    def test_html_to_text_removes_ruby_annotation_text(self) -> None:
        text = html_to_text("<p><ruby>吾輩<rt>わがはい</rt></ruby>は猫である。</p>")
        self.assertIn("吾輩", text)
        self.assertNotIn("わがはい", text)

    def test_restricted_connector_blocks_body_fetch(self) -> None:
        connector = detect_connector("https://syosetu.org/novel/123/")
        policy = connector.get_policy()
        self.assertFalse(policy.auto_fetch_allowed)
        with self.assertRaises(PolicyViolation):
            PolicyEngine().assert_can_auto_fetch(policy, user_permission=True)
        with self.assertRaises(PolicyViolation):
            connector.fetch_episode(connector.list_episodes("https://syosetu.org/novel/123/")[0])

    def test_kakuyomu_connector_lists_and_fetches_public_pages(self) -> None:
        import noveltrans.connectors.kakuyomu as kakuyomu

        work_url = "https://kakuyomu.jp/works/111"
        episode_url = "https://kakuyomu.jp/works/111/episodes/222"
        state = {
            "Work:111": {
                "__typename": "Work",
                "id": "111",
                "title": "作品名",
                "author": {"__ref": "UserAccount:7"},
                "publicEpisodeCount": 1,
                "serialStatus": "RUNNING",
                "tableOfContentsV2": [{"__ref": "TableOfContentsChapter:"}],
            },
            "UserAccount:7": {"__typename": "UserAccount", "activityName": "作者名"},
            "TableOfContentsChapter:": {
                "__typename": "TableOfContentsChapter",
                "episodeUnions": [{"__ref": "Episode:222"}],
            },
            "Episode:222": {"__typename": "Episode", "id": "222", "title": "第1話 始まり"},
        }
        next_data = json.dumps(
            {"props": {"pageProps": {"__APOLLO_STATE__": state}}},
            ensure_ascii=False,
        )
        work_html = f'<html><script id="__NEXT_DATA__" type="application/json">{next_data}</script></html>'
        episode_html = """
        <html><body>
          <p class="widget-episodeTitle">第1話 始まり</p>
          <div class="widget-episodeBody js-episode-body">
            <p id="p1">本文一。</p>
            <p id="p2"><ruby>魔法<rt>まほう</rt></ruby>だ。</p>
          </div>
        </body></html>
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
            url = request.full_url
            return FakeResponse(episode_html if url == episode_url else work_html)

        original = kakuyomu.urllib.request.urlopen
        kakuyomu.urllib.request.urlopen = fake_urlopen  # type: ignore[assignment]
        try:
            connector = detect_connector(work_url)
            policy = connector.get_policy()
            self.assertTrue(policy.auto_fetch_allowed)
            with self.assertRaises(PolicyViolation):
                PolicyEngine().assert_can_auto_fetch(policy, user_permission=True)
            PolicyEngine().assert_can_auto_fetch(
                policy,
                user_permission=True,
                permission_evidence="authorized personal use",
            )
            work = connector.get_work_metadata(work_url)
            self.assertEqual(work.title, "作品名")
            self.assertEqual(work.author, "作者名")
            metadata = connector.list_episodes(work_url)
            self.assertEqual(metadata[0].title, "第1話 始まり")
            fetched = connector.fetch_episode(metadata[0])
            self.assertEqual(fetched.episode_no, 1)
            self.assertIn("本文一。", fetched.all_text())
            self.assertIn("魔法だ。", fetched.all_text())
            self.assertNotIn("まほう", fetched.all_text())
        finally:
            kakuyomu.urllib.request.urlopen = original  # type: ignore[assignment]

    def test_policy_engine_requires_evidence_for_b_grade_auto_fetch(self) -> None:
        policy = ConnectorPolicy(
            site_name="Example B",
            grade="B",
            auto_fetch_allowed=True,
            requires_official_api=True,
            requires_user_permission=True,
            supports_login=False,
            max_rps=1.0,
            notes="test policy",
        )
        with self.assertRaises(PolicyViolation):
            PolicyEngine().assert_can_auto_fetch(policy, user_permission=True)
        PolicyEngine().assert_can_auto_fetch(
            policy,
            user_permission=True,
            permission_evidence="official API terms allow this use",
        )

    def test_local_file_connector_detects_txt(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "source.txt"
            path.write_text("第1話 始まり\n本文", encoding="utf-8")
            connector = detect_connector(path)
            self.assertEqual(connector.get_policy().site_name, "Local file")
            self.assertEqual(len(connector.list_episodes(str(path))), 1)
            self.assertEqual(connector.get_work_metadata(str(path)).title, "source")

    def test_local_html_metadata_uses_extracted_text_title(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "source.html"
            path.write_text("<html><body><h1>作品名</h1><p>本文</p></body></html>", encoding="utf-8")
            connector = detect_connector(path)
            self.assertEqual(connector.get_work_metadata(str(path)).title, "作品名")

    def test_local_zip_uses_natural_filename_order(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "source.zip"
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("episode_10.txt", "十番目")
                archive.writestr("episode_2.txt", "二番目")
                archive.writestr("episode_1.txt", "一番目")
            connector = detect_connector(path)
            metadata = connector.list_episodes(str(path))
            self.assertEqual([item.episode_no for item in metadata], [1, 2, 10])
            episodes = [connector.fetch_episode(item).all_text() for item in metadata]
            self.assertEqual(episodes, ["一番目", "二番目", "十番目"])

    def test_syosetu_url_parse(self) -> None:
        connector = SyosetuConnector()
        self.assertEqual(connector.parse("https://ncode.syosetu.com/n0000aa/12/"), ("n0000aa", 12))
        self.assertEqual(connector.parse("https://ncode.syosetu.com/n0000aa/"), ("n0000aa", None))

    def test_plugin_connector_entry_point_loading(self) -> None:
        import noveltrans.connectors as registry
        from noveltrans.connectors.local_file import LocalFileConnector

        class FakeEntryPoint:
            name = "fake_local"

            def load(self):
                return LocalFileConnector

        original = registry.metadata.entry_points
        registry.metadata.entry_points = lambda group=None: [FakeEntryPoint()]  # type: ignore[assignment]
        try:
            plugins = registry.load_plugin_connectors()
        finally:
            registry.metadata.entry_points = original  # type: ignore[assignment]
        self.assertEqual(len(plugins), 1)
        self.assertIsInstance(plugins[0], LocalFileConnector)

    def test_aozora_url_workflow_respects_ruby_option(self) -> None:
        import noveltrans.connectors.aozora as aozora

        class FakeHeaders:
            def get_content_charset(self):
                return "utf-8"

        class FakeResponse:
            headers = FakeHeaders()

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

            def read(self):
                return "吾輩《わがはい》は猫である。".encode("utf-8")

        original = aozora.urllib.request.urlopen
        aozora.urllib.request.urlopen = lambda request, timeout=30: FakeResponse()  # type: ignore[assignment]
        try:
            with tempfile.TemporaryDirectory() as tmp:
                project = create_project_from_url(
                    manager=ProjectManager(Path(tmp) / "projects"),
                    name="aozora",
                    url="https://www.aozora.gr.jp/cards/000148/files/789_14547.html",
                    translation=TranslationOptions(keep_ruby_as_parentheses=True),
                    parallel=ParallelOptions(),
                    quality=QualityOptions(),
                    export=ExportOptions(formats=["txt"]),
                    user_permission=True,
                    permission_evidence="Aozora public file confirmed",
                )
                episode = project.load_source_episode(1)
                manifest = project.load_manifest()
        finally:
            aozora.urllib.request.urlopen = original  # type: ignore[assignment]
        self.assertIn("吾輩(わがはい)", episode.all_text())
        self.assertEqual(manifest.work.extra["permission_evidence"], "Aozora public file confirmed")

    def test_aozora_connector_extracts_text_from_zip_payload(self) -> None:
        buffer = BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            archive.writestr("work.txt", "吾輩《わがはい》は猫である。")
        text = AozoraConnector()._extract_zip_text(buffer.getvalue())
        self.assertIn("吾輩", text)


if __name__ == "__main__":
    unittest.main()
