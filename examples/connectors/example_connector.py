"""Minimal third-party connector example."""

from __future__ import annotations

from noveltrans.connectors.base import NovelConnector
from noveltrans.errors import PolicyViolation
from noveltrans.models import ConnectorPolicy, EpisodeMetadata, EpisodeText, WorkMetadata


class ExampleConnector(NovelConnector):
    def detect(self, source: str) -> bool:
        return source.startswith("https://example.invalid/novel/")

    def get_policy(self) -> ConnectorPolicy:
        return ConnectorPolicy(
            site_name="Example Site",
            grade="C",
            auto_fetch_allowed=False,
            requires_official_api=False,
            requires_user_permission=True,
            supports_login=False,
            max_rps=0,
            notes="Example connector blocks automatic body fetch.",
            allowed_input_modes=["txt", "html", "zip", "clipboard"],
        )

    def get_work_metadata(self, source: str) -> WorkMetadata:
        return WorkMetadata(title="Example Work", source_url=source, site="example")

    def list_episodes(self, source: str) -> list[EpisodeMetadata]:
        return [EpisodeMetadata(episode_no=1, title="User-provided text", url=source)]

    def fetch_episode(self, episode: EpisodeMetadata) -> EpisodeText:
        raise PolicyViolation("Example Site requires user-provided text.")


def make_connector() -> NovelConnector:
    return ExampleConnector()
