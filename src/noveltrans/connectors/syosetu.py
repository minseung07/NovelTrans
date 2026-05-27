"""Syosetu metadata-only connector using the official developer API."""

from __future__ import annotations

import json
import re
import urllib.parse
import urllib.request
from urllib.parse import urlparse

from noveltrans.errors import PolicyViolation
from noveltrans.models import ConnectorPolicy, EpisodeMetadata, EpisodeText, WorkMetadata
from noveltrans.utils import now_iso

from .base import NovelConnector


NCODE_RE = re.compile(r"/(?P<ncode>n[0-9a-z]+)(?:/(?P<episode>\d+)/?)?", re.IGNORECASE)


class SyosetuConnector(NovelConnector):
    def detect(self, source: str) -> bool:
        host = urlparse(source).netloc.lower()
        return host == "ncode.syosetu.com" or host.endswith(".syosetu.com")

    def get_policy(self) -> ConnectorPolicy:
        return ConnectorPolicy(
            site_name="小説家になろう",
            grade="B",
            auto_fetch_allowed=False,
            requires_official_api=True,
            requires_user_permission=True,
            supports_login=False,
            max_rps=1.0,
            notes="공식 なろう小説API 기반 메타데이터만 조회합니다. 본문 자동 수집은 비활성화됩니다.",
            allowed_input_modes=["metadata_url", "txt", "html", "zip", "clipboard"],
        )

    def parse(self, source: str) -> tuple[str, int | None]:
        match = NCODE_RE.search(urlparse(source).path)
        if not match:
            return "", None
        episode = match.group("episode")
        return match.group("ncode").lower(), int(episode) if episode else None

    def get_work_metadata(self, source: str) -> WorkMetadata:
        ncode, episode_no = self.parse(source)
        title = ncode or "syosetu_work"
        author = ""
        extra: dict[str, object] = {}
        if ncode:
            try:
                api_url = "https://api.syosetu.com/novelapi/api/?" + urllib.parse.urlencode(
                    {"out": "json", "ncode": ncode, "of": "t-w-ga-gp"}
                )
                request = urllib.request.Request(
                    api_url,
                    headers={"User-Agent": "NovelTransCLI/1.0 metadata-only"},
                )
                with urllib.request.urlopen(request, timeout=20) as response:
                    payload = json.loads(response.read().decode("utf-8"))
                if isinstance(payload, list) and len(payload) > 1:
                    item = payload[1]
                    title = str(item.get("title") or title)
                    author = str(item.get("writer") or "")
                    extra = {k: v for k, v in item.items() if k not in {"title", "writer"}}
            except Exception as exc:  # noqa: BLE001 - metadata lookup is best effort.
                extra["metadata_error"] = str(exc)
        if episode_no:
            extra["requested_episode"] = episode_no
        return WorkMetadata(
            title=title,
            author=author,
            source_url=source,
            site="syosetu",
            work_id=ncode,
            license_note="metadata_only_official_api; body must be user-provided",
            collected_at=now_iso(),
            extra=extra,
        )

    def list_episodes(self, source: str) -> list[EpisodeMetadata]:
        ncode, episode_no = self.parse(source)
        if episode_no:
            return [
                EpisodeMetadata(
                    episode_no=episode_no,
                    title=f"{episode_no}話",
                    url=source,
                    source_id=f"{ncode}-{episode_no}",
                )
            ]
        metadata = self.get_work_metadata(source)
        count = int(metadata.extra.get("general_all_no") or 0)
        if count <= 0:
            return [EpisodeMetadata(episode_no=1, title="사용자 제공 본문", url=source, source_id=ncode)]
        return [
            EpisodeMetadata(episode_no=i, title=f"{i}話", url=f"https://ncode.syosetu.com/{ncode}/{i}/")
            for i in range(1, count + 1)
        ]

    def fetch_episode(self, episode: EpisodeMetadata) -> EpisodeText:
        raise PolicyViolation("小説家になろう 본문 자동 수집은 정책상 비활성화되어 있습니다.")
