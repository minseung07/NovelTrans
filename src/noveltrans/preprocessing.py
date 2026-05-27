"""Source normalization and local file loading."""

from __future__ import annotations

import re
import zipfile
from html.parser import HTMLParser
from pathlib import Path

from .models import EpisodeText, Section
from .utils import first_nonempty_line, read_text_detect, sha256_text


EPISODE_MARKER_RE = re.compile(
    r"^\s*(?:#{1,3}\s*)?(?P<title>(?:第\s*[\d０-９一二三四五六七八九十百千〇零]+\s*[話章節].*|Episode\s+\d+.*|EP\s*\d+.*|화\s*\d+.*))$",
    re.IGNORECASE | re.MULTILINE,
)
SECTION_MARKER_RE = re.compile(
    r"^\s*(?:#{2,4}\s*)?(?P<title>前書き|まえがき|前置き|本文|本編|後書き|あとがき|作者あとがき|후기|작가 후기|본문|전서)\s*$",
    re.IGNORECASE | re.MULTILINE,
)
EPISODE_NUMBER_RE = re.compile(
    r"(?:第|episode|ep|episode[_\s-]*|ep[_\s-]*)\s*([0-9０-９一二三四五六七八九十百千〇零]+)"
    r"|([0-9０-９一二三四五六七八九十百千〇零]+)\s*(?:話|章|節|화|회)",
    re.IGNORECASE,
)
FULL_WIDTH_DIGITS = str.maketrans("０１２３４５６７８９", "0123456789")
KANJI_DIGITS = {"〇": 0, "零": 0, "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9}
KANJI_UNITS = {"十": 10, "百": 100, "千": 1000}


class _TextExtractor(HTMLParser):
    block_tags = {
        "p",
        "div",
        "section",
        "article",
        "br",
        "li",
        "h1",
        "h2",
        "h3",
        "h4",
        "blockquote",
    }
    skip_tags = {"script", "style", "nav", "footer", "header", "noscript", "rt", "rp"}

    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []
        self.skip_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        if tag in self.skip_tags:
            self.skip_depth += 1
        if self.skip_depth == 0 and tag in self.block_tags:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag in self.skip_tags and self.skip_depth:
            self.skip_depth -= 1
        if self.skip_depth == 0 and tag in self.block_tags:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if self.skip_depth == 0:
            text = re.sub(r"[ \t\r\f\v]+", " ", data)
            if text.strip():
                self.parts.append(text)

    def text(self) -> str:
        text = "".join(self.parts)
        lines = [line.strip() for line in text.splitlines()]
        return "\n".join(line for line in lines if line)


def html_to_text(source: str) -> str:
    parser = _TextExtractor()
    parser.feed(source)
    return parser.text()


def normalize_aozora_text(text: str, keep_ruby_as_parentheses: bool = False) -> str:
    text = re.sub(r"［＃.*?］", "", text)
    if keep_ruby_as_parentheses:
        text = re.sub(r"｜?([^《\n]{1,30})《([^》]+)》", r"\1(\2)", text)
    else:
        text = re.sub(r"｜?([^《\n]{1,30})《[^》]+》", r"\1", text)
        text = re.sub(r"《[^》]{1,30}》", "", text)
    return normalize_text(text)


def normalize_text(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = text.replace("\u3000", " ")
    text = re.sub(r"[ \t]+$", "", text, flags=re.MULTILINE)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def split_plain_text(text: str, source_url: str = "") -> list[EpisodeText]:
    text = normalize_text(text)
    markers = list(EPISODE_MARKER_RE.finditer(text))
    episodes: list[EpisodeText] = []
    if not markers:
        title = first_nonempty_line(text, "Episode 1")
        body = _strip_repeated_title(text, title)
        episode_no = _extract_episode_number(title) or _extract_episode_number(source_url) or 1
        return [
            EpisodeText(
                episode_no=episode_no,
                title=title,
                sections=split_sections(body),
                source_url=source_url,
                source_hash=sha256_text(body),
            )
        ]

    used_numbers: set[int] = set()
    next_episode_no = 1
    for index, marker in enumerate(markers):
        start = marker.end()
        end = markers[index + 1].start() if index + 1 < len(markers) else len(text)
        title = marker.group("title").strip("# ").strip()
        body = text[start:end].strip()
        if not body:
            continue
        episode_no = _unique_episode_number(_extract_episode_number(title), used_numbers, next_episode_no)
        used_numbers.add(episode_no)
        next_episode_no = episode_no + 1
        episodes.append(
            EpisodeText(
                episode_no=episode_no,
                title=title,
                sections=split_sections(body),
                source_url=source_url,
                source_hash=sha256_text(body),
            )
        )
    if not episodes:
        title = markers[0].group("title").strip("# ").strip()
        body = _non_marker_text(text)
        episode_no = _extract_episode_number(title) or _extract_episode_number(source_url) or 1
        return [
            EpisodeText(
                episode_no=episode_no,
                title=title,
                sections=split_sections(body),
                source_url=source_url,
                source_hash=sha256_text(body),
            )
        ]
    return episodes


def _strip_repeated_title(text: str, title: str) -> str:
    lines = text.splitlines()
    if lines and lines[0].strip() == title.strip():
        return "\n".join(lines[1:]).strip() or text
    return text


def _non_marker_text(text: str) -> str:
    lines = []
    for line in text.splitlines():
        if EPISODE_MARKER_RE.match(line):
            continue
        lines.append(line)
    return "\n".join(lines).strip()


def split_sections(text: str) -> list[Section]:
    text = normalize_text(text)
    markers = list(SECTION_MARKER_RE.finditer(text))
    if not markers:
        return [Section(type="body", text=text)]
    sections: list[Section] = []
    if markers[0].start() > 0:
        prefix = text[: markers[0].start()].strip()
        if prefix:
            sections.append(Section(type="body", text=prefix))
    for index, marker in enumerate(markers):
        start = marker.end()
        end = markers[index + 1].start() if index + 1 < len(markers) else len(text)
        content = text[start:end].strip()
        if not content:
            continue
        sections.append(Section(type=_section_type(marker.group("title")), text=content))
    if not sections:
        return [Section(type="body", text=text)]
    return _merge_same_type_sections(sections)


def _section_type(title: str) -> str:
    normalized = title.strip().lower().replace(" ", "")
    if normalized in {"前書き", "まえがき", "前置き", "전서"}:
        return "foreword"
    if normalized in {"後書き", "あとがき", "作者あとがき", "후기", "작가후기"}:
        return "afterword"
    return "body"


def _merge_same_type_sections(sections: list[Section]) -> list[Section]:
    merged: list[Section] = []
    for section in sections:
        if merged and merged[-1].type == section.type:
            merged[-1] = Section(type=section.type, text=merged[-1].text.rstrip() + "\n\n" + section.text.strip())
        else:
            merged.append(section)
    return merged


def normalize_episode(episode: EpisodeText, keep_ruby_as_parentheses: bool = False) -> EpisodeText:
    sections: list[Section] = []
    for section in episode.sections:
        text = section.text
        text = normalize_aozora_text(text, keep_ruby_as_parentheses=keep_ruby_as_parentheses)
        sections.append(Section(type=section.type, text=text))
    all_text = "\n\n".join(section.text for section in sections)
    metadata = dict(episode.metadata)
    metadata["paragraphs"] = _paragraph_metadata(episode.episode_no, sections)
    return EpisodeText(
        episode_no=episode.episode_no,
        title=normalize_text(episode.title),
        sections=sections,
        source_url=episode.source_url,
        source_hash=sha256_text(all_text),
        metadata=metadata,
    )


def load_local_episodes(path: Path) -> list[EpisodeText]:
    if not path.exists():
        raise FileNotFoundError(path)
    if path.suffix.lower() == ".zip":
        return _load_zip_episodes(path)
    text = read_text_detect(path)
    if path.suffix.lower() in {".html", ".htm"}:
        text = html_to_text(text)
    return split_plain_text(text, source_url=str(path))


def _load_zip_episodes(path: Path) -> list[EpisodeText]:
    episodes: list[EpisodeText] = []
    used_numbers: set[int] = set()
    next_episode_no = 1
    with zipfile.ZipFile(path) as archive:
        names = sorted(
            [
                name
                for name in archive.namelist()
                if not name.endswith("/") and Path(name).suffix.lower() in {".txt", ".html", ".htm"}
            ],
            key=_natural_sort_key,
        )
        for name in names:
            data = archive.read(name)
            text = _decode_bytes(data)
            if Path(name).suffix.lower() in {".html", ".htm"}:
                text = html_to_text(text)
            split = split_plain_text(text, source_url=f"{path}!{name}")
            for item in split:
                episode_no = _unique_episode_number(item.episode_no, used_numbers, next_episode_no)
                used_numbers.add(episode_no)
                next_episode_no = episode_no + 1
                title = Path(name).stem if len(split) == 1 and item.title == "Episode 1" else item.title
                episodes.append(
                    EpisodeText(
                        episode_no=episode_no,
                        title=title,
                        sections=item.sections,
                        source_url=item.source_url,
                        source_hash=item.source_hash,
                        metadata=item.metadata,
                    )
                )
    return episodes


def _decode_bytes(data: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-8", "cp932", "shift_jis", "euc_jp"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")


def _natural_sort_key(value: str) -> list[object]:
    return [int(part) if part.isdigit() else part.lower() for part in re.split(r"(\d+)", value)]


def _paragraph_metadata(episode_no: int, sections: list[Section]) -> list[dict[str, object]]:
    paragraphs: list[dict[str, object]] = []
    counters: dict[str, int] = {}
    for section_index, section in enumerate(sections, start=1):
        counters.setdefault(section.type, 0)
        for paragraph in _split_paragraphs(section.text):
            counters[section.type] += 1
            paragraph_id = f"e{episode_no:03d}-{section.type}-{counters[section.type]:03d}"
            paragraphs.append(
                {
                    "id": paragraph_id,
                    "section": section.type,
                    "section_index": section_index,
                    "paragraph_index": counters[section.type],
                    "hash": sha256_text(paragraph),
                }
            )
    return paragraphs


def _split_paragraphs(text: str) -> list[str]:
    return [paragraph.strip() for paragraph in re.split(r"\n\s*\n", text.strip()) if paragraph.strip()]


def _unique_episode_number(candidate: int | None, used_numbers: set[int], fallback_start: int) -> int:
    if candidate and candidate > 0 and candidate not in used_numbers:
        return candidate
    number = max(1, fallback_start)
    while number in used_numbers:
        number += 1
    return number


def _extract_episode_number(value: str) -> int | None:
    match = EPISODE_NUMBER_RE.search(value.translate(FULL_WIDTH_DIGITS))
    if not match:
        return None
    token = next((group for group in match.groups() if group), "")
    if not token:
        return None
    return _parse_episode_number_token(token)


def _parse_episode_number_token(token: str) -> int | None:
    token = token.translate(FULL_WIDTH_DIGITS)
    if token.isdigit():
        number = int(token)
        return number if number > 0 else None
    if not all(char in KANJI_DIGITS or char in KANJI_UNITS for char in token):
        return None
    if not any(char in KANJI_UNITS for char in token):
        digits = "".join(str(KANJI_DIGITS[char]) for char in token)
        number = int(digits)
        return number if number > 0 else None
    total = 0
    current = 0
    for char in token:
        if char in KANJI_DIGITS:
            current = KANJI_DIGITS[char]
        elif char in KANJI_UNITS:
            total += (current or 1) * KANJI_UNITS[char]
            current = 0
    number = total + current
    return number if number > 0 else None
