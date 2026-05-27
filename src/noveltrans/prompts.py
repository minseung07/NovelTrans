"""Translation prompt construction."""

from __future__ import annotations

import json
from dataclasses import asdict

from .models import EpisodeText, GlossaryEntry, TranslationOptions


SYSTEM_PROMPT = """너는 일본 웹소설을 한국어 웹소설 문체로 번역하는 전문 번역가다.
고유명사와 설정 용어는 제공된 용어집을 우선한다.
원문 문단 순서를 유지하고, 누락, 요약, 검열을 하지 않는다.
의성어와 의태어는 한국어 독자가 자연스럽게 읽을 수 있게 조정한다.
작가 후기는 본문과 구분해 번역한다.
translate_author_notes가 false이면 afterword_ko는 빈 문자열로 반환한다.
반드시 JSON 객체만 반환한다."""


TRANSLATION_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": [
        "title_ko",
        "foreword_ko",
        "body_ko",
        "afterword_ko",
        "new_terms",
        "term_conflicts",
        "episode_summary",
        "qa_notes",
    ],
    "properties": {
        "title_ko": {"type": "string"},
        "foreword_ko": {"type": "string"},
        "body_ko": {"type": "string"},
        "afterword_ko": {"type": "string"},
        "new_terms": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["source", "target", "type", "confidence", "reason"],
                "properties": {
                    "source": {"type": "string"},
                    "target": {"type": "string"},
                    "type": {"type": "string"},
                    "confidence": {"type": "number"},
                    "reason": {"type": "string"},
                },
            },
        },
        "term_conflicts": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["source", "previous", "suggested", "recommendation"],
                "properties": {
                    "source": {"type": "string"},
                    "previous": {"type": "string"},
                    "suggested": {"type": "string"},
                    "recommendation": {"type": "string"},
                },
            },
        },
        "episode_summary": {"type": "string"},
        "qa_notes": {"type": "array", "items": {"type": "string"}},
    },
}


def build_episode_payload(
    episode: EpisodeText,
    options: TranslationOptions,
    glossary: list[GlossaryEntry],
    previous_summary: str = "",
) -> str:
    payload = {
        "episode_no": episode.episode_no,
        "title": episode.title,
        "style_profile": options.style,
        "preset": options.preset,
        "honorific_policy": options.honorific_policy,
        "preserve_japanese_suffixes": options.preserve_japanese_suffixes,
        "translate_author_notes": options.translate_author_notes,
        "glossary_strictness": options.glossary_strictness,
        "glossary": [_glossary_payload(entry) for entry in glossary],
        "previous_summary": previous_summary,
        "sections": [asdict(section) for section in episode.sections],
    }
    return json.dumps(payload, ensure_ascii=False, indent=2)


def _glossary_payload(entry: GlossaryEntry) -> dict[str, object]:
    payload = asdict(entry)
    if not entry.locked and entry.target == entry.source and "auto-seeded" in entry.notes:
        payload["target"] = ""
        payload["notes"] = f"{entry.notes}; target pending, propose a natural Korean translation"
    return payload
