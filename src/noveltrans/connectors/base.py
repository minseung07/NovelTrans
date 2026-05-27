"""Base connector interface."""

from __future__ import annotations

from abc import ABC, abstractmethod

from noveltrans.models import ConnectorPolicy, EpisodeMetadata, EpisodeText, WorkMetadata


class NovelConnector(ABC):
    """Common interface for web and local source connectors."""

    @abstractmethod
    def detect(self, source: str) -> bool:
        raise NotImplementedError

    @abstractmethod
    def get_policy(self) -> ConnectorPolicy:
        raise NotImplementedError

    @abstractmethod
    def get_work_metadata(self, source: str) -> WorkMetadata:
        raise NotImplementedError

    @abstractmethod
    def list_episodes(self, source: str) -> list[EpisodeMetadata]:
        raise NotImplementedError

    @abstractmethod
    def fetch_episode(self, episode: EpisodeMetadata) -> EpisodeText:
        raise NotImplementedError
