"""Aozora Bunko connector."""

from __future__ import annotations

import re
import urllib.request
import zipfile
from io import BytesIO
from pathlib import Path
from urllib.parse import urlparse

from noveltrans.errors import SourceInputError
from noveltrans.models import ConnectorPolicy, EpisodeMetadata, EpisodeText, Section, WorkMetadata
from noveltrans.preprocessing import html_to_text, normalize_text
from noveltrans.utils import first_nonempty_line, now_iso, sha256_text

from .base import NovelConnector


class AozoraConnector(NovelConnector):
    def detect(self, source: str) -> bool:
        host = urlparse(source).netloc.lower()
        return host.endswith("aozora.gr.jp")

    def get_policy(self) -> ConnectorPolicy:
        return ConnectorPolicy(
            site_name="青空文庫",
            grade="A",
            auto_fetch_allowed=True,
            requires_official_api=False,
            requires_user_permission=True,
            supports_login=False,
            max_rps=0.5,
            notes="저작권이 소멸했거나 사용 조건이 명확한 공개 파일 중심으로 지원합니다.",
            allowed_input_modes=["url", "txt", "html"],
        )

    def get_work_metadata(self, source: str) -> WorkMetadata:
        parsed = urlparse(source)
        work_id = parsed.path.strip("/").replace("/", "_") or "aozora"
        title = re.sub(r"[_-]+", " ", work_id).strip() or "Aozora Work"
        return WorkMetadata(
            title=title,
            source_url=source,
            site="aozora",
            work_id=work_id,
            license_note="Aozora Bunko public file; verify copyright status for the selected work.",
            collected_at=now_iso(),
        )

    def list_episodes(self, source: str) -> list[EpisodeMetadata]:
        metadata = self.get_work_metadata(source)
        return [EpisodeMetadata(episode_no=1, title=metadata.title, url=source, source_id=metadata.work_id)]

    def fetch_episode(self, episode: EpisodeMetadata) -> EpisodeText:
        request = urllib.request.Request(
            episode.url,
            headers={"User-Agent": "NovelTransCLI/1.0 (+authorized personal translation workflow)"},
        )
        with urllib.request.urlopen(request, timeout=30) as response:
            body = response.read()
            charset = response.headers.get_content_charset()
            content_type = response.headers.get("content-type", "") if hasattr(response.headers, "get") else ""
        if episode.url.lower().endswith(".zip") or "zip" in content_type.lower():
            text = self._extract_zip_text(body)
        else:
            text = self._decode(body, charset)
        if "<html" in text[:500].lower() or "</" in text[:2000].lower():
            text = html_to_text(text)
        text = normalize_text(text)
        title = first_nonempty_line(text, episode.title)
        return EpisodeText(
            episode_no=episode.episode_no,
            title=title,
            sections=[Section(type="body", text=text)],
            source_url=episode.url,
            source_hash=sha256_text(text),
        )

    def _decode(self, body: bytes, charset: str | None) -> str:
        encodings = [charset] if charset else []
        encodings.extend(["utf-8-sig", "utf-8", "shift_jis", "cp932", "euc_jp"])
        for encoding in encodings:
            if not encoding:
                continue
            try:
                return body.decode(encoding)
            except UnicodeDecodeError:
                continue
        return body.decode("utf-8", errors="replace")

    def _extract_zip_text(self, body: bytes) -> str:
        with zipfile.ZipFile(BytesIO(body)) as archive:
            names = sorted(
                name
                for name in archive.namelist()
                if not name.endswith("/") and Path(name).suffix.lower() in {".txt", ".html", ".htm"}
            )
            if not names:
                raise SourceInputError("Aozora ZIP did not contain txt/html source")
            name = names[0]
            text = self._decode(archive.read(name), None)
            if Path(name).suffix.lower() in {".html", ".htm"}:
                text = html_to_text(text)
            return text
