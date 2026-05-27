"""Local TXT/HTML/ZIP connector."""

from __future__ import annotations

from pathlib import Path

from noveltrans.models import ConnectorPolicy, EpisodeMetadata, EpisodeText, WorkMetadata
from noveltrans.preprocessing import EPISODE_MARKER_RE, html_to_text, load_local_episodes
from noveltrans.utils import first_nonempty_line, now_iso
from noveltrans.utils import read_text_detect

from .base import NovelConnector


class LocalFileConnector(NovelConnector):
    def detect(self, source: str) -> bool:
        path = Path(source).expanduser()
        return path.exists() and path.suffix.lower() in {".txt", ".html", ".htm", ".zip"}

    def get_policy(self) -> ConnectorPolicy:
        return ConnectorPolicy(
            site_name="Local file",
            grade="A",
            auto_fetch_allowed=True,
            requires_official_api=False,
            requires_user_permission=True,
            supports_login=False,
            max_rps=0,
            notes="사용자가 직접 제공한 TXT/HTML/ZIP 파일만 처리합니다.",
            allowed_input_modes=["txt", "html", "zip", "clipboard", "manual"],
        )

    def get_work_metadata(self, source: str) -> WorkMetadata:
        path = Path(source).expanduser()
        title = path.stem
        if path.is_file() and path.suffix.lower() in {".txt", ".html", ".htm"}:
            try:
                text = read_text_detect(path)
                if path.suffix.lower() in {".html", ".htm"}:
                    text = html_to_text(text)
                first_line = first_nonempty_line(text, title)
                if not EPISODE_MARKER_RE.match(first_line):
                    title = first_line
            except OSError:
                pass
        return WorkMetadata(
            title=title,
            source_url=str(path),
            site="local",
            work_id=path.stem,
            license_note="user_provided",
            collected_at=now_iso(),
        )

    def list_episodes(self, source: str) -> list[EpisodeMetadata]:
        episodes = load_local_episodes(Path(source).expanduser())
        return [
            EpisodeMetadata(episode_no=episode.episode_no, title=episode.title, url=str(source))
            for episode in episodes
        ]

    def fetch_episode(self, episode: EpisodeMetadata) -> EpisodeText:
        episodes = load_local_episodes(Path(episode.url).expanduser())
        for item in episodes:
            if item.episode_no == episode.episode_no:
                return item
        raise FileNotFoundError(f"Episode {episode.episode_no} not found in {episode.url}")
