"""Kakuyomu public-page connector for personal authorized workflows."""

from __future__ import annotations

import html
import json
import re
import urllib.error
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from urllib.parse import urlparse

from noveltrans.errors import SourceInputError
from noveltrans.models import ConnectorPolicy, EpisodeMetadata, EpisodeText, Section, WorkMetadata
from noveltrans.preprocessing import normalize_text
from noveltrans.utils import now_iso, sha256_text

from .base import NovelConnector


BASE_URL = "https://kakuyomu.jp"
WORK_RE = re.compile(r"/works/(?P<work_id>[^/?#]+)(?:/episodes/(?P<episode_id>[^/?#]+))?/?")
NEXT_DATA_RE = re.compile(
    r'<script\s+id="__NEXT_DATA__"\s+type="application/json">(.*?)</script>',
    re.DOTALL,
)


class KakuyomuConnector(NovelConnector):
    def detect(self, source: str) -> bool:
        host = urlparse(source).netloc.lower()
        return host == "kakuyomu.jp" or host.endswith(".kakuyomu.jp")

    def get_policy(self) -> ConnectorPolicy:
        return ConnectorPolicy(
            site_name="カクヨム",
            grade="B",
            auto_fetch_allowed=True,
            requires_official_api=False,
            requires_user_permission=True,
            supports_login=False,
            max_rps=1.0,
            notes=(
                "공개 게스트 페이지의 작품/화 본문만 낮은 빈도로 가져옵니다. "
                "로그인, 유료/비공개 회차, 쿠키 가져오기, 우회 접근은 지원하지 않습니다."
            ),
            allowed_input_modes=["url", "txt", "html", "zip", "clipboard", "manual"],
        )

    def parse(self, source: str) -> tuple[str, str | None]:
        match = WORK_RE.search(urlparse(source).path)
        if not match:
            return "", None
        return match.group("work_id"), match.group("episode_id")

    def get_work_metadata(self, source: str) -> WorkMetadata:
        work_id, episode_id = self.parse(source)
        if not work_id:
            raise SourceInputError(f"Unsupported Kakuyomu URL: {source}")
        extra: dict[str, object] = {}
        if not work_id.isdigit():
            if episode_id:
                extra["requested_episode_id"] = episode_id
            return WorkMetadata(
                title=f"kakuyomu_{work_id}",
                source_url=source,
                site="kakuyomu",
                work_id=work_id,
                license_note="Kakuyomu URL metadata only; body must be user-provided",
                collected_at=now_iso(),
                extra=extra,
            )
        try:
            html_text = self._open_text(self._work_url(work_id))
        except (OSError, SourceInputError) as exc:
            html_text = ""
            extra["metadata_error"] = str(exc)
        state = _apollo_state(html_text)
        work_object = state.get(f"Work:{work_id}", {})
        work = work_object if isinstance(work_object, dict) else {}
        title = str(work.get("title") or _meta_content(html_text, "og:title") or f"kakuyomu_{work_id}")
        title = title.removesuffix(" - カクヨム").strip()
        author = _author_name(state, work)
        extra.update(
            {
                "public_episode_count": work.get("publicEpisodeCount", 0),
                "serial_status": work.get("serialStatus", ""),
            }
        )
        if episode_id:
            extra["requested_episode_id"] = episode_id
        return WorkMetadata(
            title=title,
            author=author,
            source_url=source,
            site="kakuyomu",
            work_id=work_id,
            license_note="Kakuyomu public guest page; authorized personal use only; no redistribution",
            collected_at=now_iso(),
            extra=extra,
        )

    def list_episodes(self, source: str) -> list[EpisodeMetadata]:
        work_id, episode_id = self.parse(source)
        if not work_id:
            raise SourceInputError(f"Unsupported Kakuyomu URL: {source}")
        if episode_id:
            title = (
                self._episode_title(self._episode_url(work_id, episode_id), f"Episode {episode_id}")
                if work_id.isdigit()
                else f"Episode {episode_id}"
            )
            return [
                EpisodeMetadata(
                    episode_no=1,
                    title=title,
                    url=self._episode_url(work_id, episode_id),
                    source_id=episode_id,
                )
            ]
        if not work_id.isdigit():
            return [EpisodeMetadata(episode_no=1, title="사용자 제공 본문", url=source, source_id=work_id)]
        html_text = self._open_text(self._work_url(work_id))
        state = _apollo_state(html_text)
        episodes = _episodes_from_state(state, work_id)
        if episodes:
            return episodes
        fallback = _episodes_from_links(html_text, work_id)
        if fallback:
            return fallback
        raise SourceInputError(f"Kakuyomu episode list not found: {source}")

    def fetch_episode(self, episode: EpisodeMetadata) -> EpisodeText:
        html_text = self._open_text(episode.url)
        parser = _KakuyomuEpisodeParser()
        parser.feed(html_text)
        title = parser.title.strip() or _episode_title_from_html(html_text) or episode.title
        text = normalize_text("\n\n".join(parser.paragraphs))
        if not text:
            raise SourceInputError(f"Kakuyomu episode body not found: {episode.url}")
        return EpisodeText(
            episode_no=episode.episode_no,
            title=normalize_text(title),
            sections=[Section(type="body", text=text)],
            source_url=episode.url,
            source_hash=sha256_text(text),
            metadata={"source_id": episode.source_id},
        )

    def _episode_title(self, url: str, fallback: str) -> str:
        try:
            return _episode_title_from_html(self._open_text(url)) or fallback
        except (OSError, SourceInputError):
            return fallback

    def _open_text(self, url: str) -> str:
        request = urllib.request.Request(
            url,
            headers={
                "User-Agent": "NovelTransCLI/1.0 (+authorized personal translation workflow)",
                "Accept": "text/html,application/xhtml+xml",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                body = response.read()
                charset = (
                    response.headers.get_content_charset()
                    if hasattr(response.headers, "get_content_charset")
                    else None
                )
        except urllib.error.HTTPError as exc:
            if exc.code in {401, 402, 403, 404}:
                raise SourceInputError(
                    f"Kakuyomu public page is not accessible without login or permission: {url}"
                ) from exc
            raise
        return _decode(body, charset)

    def _work_url(self, work_id: str) -> str:
        return f"{BASE_URL}/works/{work_id}"

    def _episode_url(self, work_id: str, episode_id: str) -> str:
        return f"{BASE_URL}/works/{work_id}/episodes/{episode_id}"


class _KakuyomuEpisodeParser(HTMLParser):
    skip_tags = {"script", "style", "nav", "footer", "header", "noscript", "rt", "rp", "svg"}

    def __init__(self) -> None:
        super().__init__()
        self.title = ""
        self.paragraphs: list[str] = []
        self._body_depth = 0
        self._title_depth = 0
        self._paragraph_depth = 0
        self._skip_depth = 0
        self._current_parts: list[str] = []
        self._title_parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        attr_map = {name.lower(): value or "" for name, value in attrs}
        class_value = attr_map.get("class", "")
        if tag in self.skip_tags:
            self._skip_depth += 1
            return
        if tag == "br":
            if self._paragraph_depth:
                self._current_parts.append("\n")
            return
        if "js-episode-body" in class_value.split():
            self._body_depth = 1
        elif self._body_depth:
            self._body_depth += 1
        if "widget-episodeTitle" in class_value.split():
            self._title_depth = 1
            self._title_parts = []
        elif self._title_depth:
            self._title_depth += 1
        if self._body_depth and tag == "p":
            self._paragraph_depth = 1
            self._current_parts = []
        elif self._paragraph_depth:
            self._paragraph_depth += 1

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag == "br":
            return
        if tag in self.skip_tags and self._skip_depth:
            self._skip_depth -= 1
            return
        if self._paragraph_depth:
            self._paragraph_depth -= 1
            if self._paragraph_depth == 0:
                paragraph = normalize_text("".join(self._current_parts))
                if paragraph:
                    self.paragraphs.append(paragraph)
                self._current_parts = []
        if self._title_depth:
            self._title_depth -= 1
            if self._title_depth == 0 and not self.title:
                self.title = normalize_text("".join(self._title_parts))
        if self._body_depth:
            self._body_depth -= 1

    def handle_data(self, data: str) -> None:
        if self._skip_depth:
            return
        if self._paragraph_depth:
            self._current_parts.append(data)
        if self._title_depth:
            self._title_parts.append(data)


def _decode(body: bytes, charset: str | None) -> str:
    encodings = [charset] if charset else []
    encodings.extend(["utf-8-sig", "utf-8", "cp932"])
    for encoding in encodings:
        if not encoding:
            continue
        try:
            return body.decode(encoding)
        except UnicodeDecodeError:
            continue
    return body.decode("utf-8", errors="replace")


def _apollo_state(source: str) -> dict[str, object]:
    match = NEXT_DATA_RE.search(source)
    if not match:
        return {}
    try:
        data = json.loads(html.unescape(match.group(1)))
    except json.JSONDecodeError:
        return {}
    state = data.get("props", {}).get("pageProps", {}).get("__APOLLO_STATE__", {})
    return state if isinstance(state, dict) else {}


def _author_name(state: dict[str, object], work: object) -> str:
    if not isinstance(work, dict):
        return ""
    author = work.get("author")
    if not isinstance(author, dict):
        return ""
    ref = author.get("__ref")
    if not isinstance(ref, str):
        return ""
    user = state.get(ref)
    if not isinstance(user, dict):
        return ""
    return str(user.get("activityName") or user.get("name") or "")


def _episodes_from_state(state: dict[str, object], work_id: str) -> list[EpisodeMetadata]:
    work = state.get(f"Work:{work_id}", {})
    if not isinstance(work, dict):
        return []
    refs: list[str] = []
    for chapter_ref in work.get("tableOfContentsV2", []) or []:
        if not isinstance(chapter_ref, dict):
            continue
        chapter_key = chapter_ref.get("__ref")
        chapter = state.get(chapter_key) if isinstance(chapter_key, str) else None
        if not isinstance(chapter, dict):
            continue
        for episode_ref in chapter.get("episodeUnions", []) or []:
            if isinstance(episode_ref, dict) and isinstance(episode_ref.get("__ref"), str):
                refs.append(str(episode_ref["__ref"]))
    episodes: list[EpisodeMetadata] = []
    seen: set[str] = set()
    for ref in refs:
        item = state.get(ref)
        if not isinstance(item, dict):
            continue
        episode_id = str(item.get("id") or ref.rsplit(":", 1)[-1])
        if not episode_id or episode_id in seen:
            continue
        seen.add(episode_id)
        episodes.append(
            EpisodeMetadata(
                episode_no=len(episodes) + 1,
                title=str(item.get("title") or f"{len(episodes) + 1}話"),
                url=f"{BASE_URL}/works/{work_id}/episodes/{episode_id}",
                source_id=episode_id,
            )
        )
    return episodes


def _episodes_from_links(source: str, work_id: str) -> list[EpisodeMetadata]:
    pattern = re.compile(
        rf'href="(?P<url>/works/{re.escape(work_id)}/episodes/(?P<id>\d+))"[^>]*>(?P<title>.*?)</a>',
        re.DOTALL,
    )
    episodes: list[EpisodeMetadata] = []
    seen: set[str] = set()
    for match in pattern.finditer(source):
        episode_id = match.group("id")
        if episode_id in seen:
            continue
        seen.add(episode_id)
        title = normalize_text(re.sub(r"<.*?>", "", html.unescape(match.group("title"))))
        episodes.append(
            EpisodeMetadata(
                episode_no=len(episodes) + 1,
                title=title or f"{len(episodes) + 1}話",
                url=urllib.parse.urljoin(BASE_URL, match.group("url")),
                source_id=episode_id,
            )
        )
    return episodes


def _episode_title_from_html(source: str) -> str:
    parser = _KakuyomuEpisodeParser()
    parser.feed(source)
    if parser.title:
        return parser.title
    title = _meta_content(source, "og:title")
    if not title:
        return ""
    return title.split(" - ", 1)[0].strip()


def _meta_content(source: str, property_name: str) -> str:
    pattern = re.compile(
        rf'<meta\s+(?:property|name)="{re.escape(property_name)}"\s+content="(?P<content>.*?)"',
        re.IGNORECASE | re.DOTALL,
    )
    match = pattern.search(source)
    return html.unescape(match.group("content")).strip() if match else ""
