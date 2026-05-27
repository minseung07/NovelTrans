"""Restricted metadata-only connectors."""

from __future__ import annotations

from urllib.parse import urlparse

from noveltrans.errors import PolicyViolation
from noveltrans.models import ConnectorPolicy, EpisodeMetadata, EpisodeText, WorkMetadata
from noveltrans.utils import now_iso

from .base import NovelConnector


class _RestrictedConnector(NovelConnector):
    site_name = "restricted"
    site_key = "restricted"
    grade = "C"
    host_fragments: tuple[str, ...] = ()
    notes = "자동 본문 수집은 지원하지 않습니다. 사용자 제공 파일만 처리합니다."

    def detect(self, source: str) -> bool:
        host = urlparse(source).netloc.lower()
        return any(fragment in host for fragment in self.host_fragments)

    def get_policy(self) -> ConnectorPolicy:
        return ConnectorPolicy(
            site_name=self.site_name,
            grade=self.grade,  # type: ignore[arg-type]
            auto_fetch_allowed=False,
            requires_official_api=False,
            requires_user_permission=True,
            supports_login=False,
            max_rps=0,
            notes=self.notes,
            allowed_input_modes=["txt", "html", "zip", "clipboard", "manual"],
        )

    def get_work_metadata(self, source: str) -> WorkMetadata:
        parsed = urlparse(source)
        work_id = parsed.path.strip("/").replace("/", "_") or self.site_key
        return WorkMetadata(
            title=work_id,
            source_url=source,
            site=self.site_key,
            work_id=work_id,
            license_note="metadata_only; body must be user-provided",
            collected_at=now_iso(),
        )

    def list_episodes(self, source: str) -> list[EpisodeMetadata]:
        metadata = self.get_work_metadata(source)
        return [EpisodeMetadata(episode_no=1, title="사용자 제공 본문", url=source, source_id=metadata.work_id)]

    def fetch_episode(self, episode: EpisodeMetadata) -> EpisodeText:
        raise PolicyViolation(f"{self.site_name} 본문 자동 수집은 지원하지 않습니다.")


class HamelnConnector(_RestrictedConnector):
    site_name = "ハーメルン"
    site_key = "hameln"
    grade = "D"
    host_fragments = ("syosetu.org",)
    notes = "2차 창작과 사이트 정책 리스크가 커서 자동 본문 수집을 금지합니다."


class PixivConnector(_RestrictedConnector):
    site_name = "pixiv 小説"
    site_key = "pixiv"
    grade = "D"
    host_fragments = ("pixiv.net",)
    notes = "공식 공개 API 없는 크롤링 기반 수집을 지원하지 않습니다."
