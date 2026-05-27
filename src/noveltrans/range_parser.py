"""Episode range parsing."""

from __future__ import annotations

import re

from .errors import EpisodeRangeError

KANJI_DIGITS = {"〇": 0, "零": 0, "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9}
KANJI_UNITS = {"十": 10, "百": 100, "千": 1000}


def parse_episode_range(spec: str, available: list[int]) -> list[int]:
    """Parse values like `1-10`, `5,8,12-20`, or `latest 5`."""

    ordered = sorted(set(available))
    if not ordered:
        return []
    spec = _normalize_digits(spec.strip()).replace("~", "-").replace("～", "-")
    if not spec or spec.lower() in {"all", "전체", "*"}:
        return ordered

    latest_match = re.match(
        r"^(?:latest|최신|最新)\s*([0-9一二三四五六七八九十百千〇零]+)\s*(?:episodes?|화|회|話)?$",
        spec,
        flags=re.IGNORECASE,
    )
    if latest_match:
        count = _parse_number_token(latest_match.group(1))
        if count < 1:
            raise EpisodeRangeError("최신 화수는 1 이상이어야 합니다.")
        return ordered[-count:]

    selected: set[int] = set()
    for part in spec.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            left, right = part.split("-", 1)
            start = _parse_episode_number(left)
            end = _parse_episode_number(right)
            if start > end:
                start, end = end, start
            selected.update(range(start, end + 1))
        else:
            selected.add(_parse_episode_number(part))
    available_set = set(ordered)
    result = [number for number in ordered if number in selected and number in available_set]
    if not result:
        raise EpisodeRangeError(f"선택한 화수 범위에 해당하는 에피소드가 없습니다: {spec}")
    return result


def parse_single_episode_number(spec: str) -> int | None:
    """Return a single requested episode number, or None for ranges/latest/all."""

    spec = _normalize_digits(spec.strip()).replace("~", "-").replace("～", "-")
    if not spec or spec.lower() in {"all", "전체", "*"}:
        return None
    if "," in spec or "-" in spec:
        return None
    if re.match(r"^(?:latest|최신|最新)\b", spec, flags=re.IGNORECASE):
        return None
    return _parse_episode_number(spec)


def _parse_episode_number(value: str) -> int:
    value = _normalize_digits(value)
    match = re.fullmatch(
        r"\s*(?:episode|ep|제|第)?\s*([0-9一二三四五六七八九十百千〇零]+)\s*(?:화|회|話|章|節)?\s*",
        value,
        flags=re.IGNORECASE,
    )
    if not match:
        raise EpisodeRangeError(f"화수 범위를 해석할 수 없습니다: {value.strip()}")
    number = _parse_number_token(match.group(1))
    if number < 1:
        raise EpisodeRangeError("화수는 1 이상이어야 합니다.")
    return number


def _normalize_digits(value: str) -> str:
    return value.translate(str.maketrans("０１２３４５６７８９", "0123456789"))


def _parse_number_token(token: str) -> int:
    if token.isdigit():
        return int(token)
    if not all(char in KANJI_DIGITS or char in KANJI_UNITS for char in token):
        raise EpisodeRangeError(f"화수 범위를 해석할 수 없습니다: {token}")
    if not any(char in KANJI_UNITS for char in token):
        return int("".join(str(KANJI_DIGITS[char]) for char in token))
    total = 0
    current = 0
    for char in token:
        if char in KANJI_DIGITS:
            current = KANJI_DIGITS[char]
        elif char in KANJI_UNITS:
            total += (current or 1) * KANJI_UNITS[char]
            current = 0
    return total + current
