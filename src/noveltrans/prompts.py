"""Translation prompt construction."""

from __future__ import annotations

import json
from dataclasses import asdict

from .glossary import is_confirmed_entry, is_pending_entry, normalize_status
from .models import EpisodeText, GlossaryEntry, TranslationOptions


SYSTEM_PROMPT = """너는 일본 웹소설을 한국어 웹소설 문체로 번역하는 전문 번역가다.
고유명사와 설정 용어는 제공된 프로젝트 용어집을 우선한다.
locked_glossary의 target은 반드시 그대로 사용한다.
accepted_glossary는 기본적으로 그대로 사용하고, forbidden_targets에 있는 번역어는 쓰지 않는다.
candidate_terms는 확정 용어가 아니다. 필요하면 new_terms에 proposal만 반환한다.
source가 입력 원문에 실제 존재하지 않는 용어는 new_terms에 넣지 않는다.
기존 accepted/locked target과 다르게 번역했다면 term_conflicts에 보고한다.
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
                "required": [
                    "source",
                    "target",
                    "type",
                    "confidence",
                    "reason",
                    "evidence_quote",
                    "alternative_targets",
                    "used_in_translation",
                ],
                "properties": {
                    "source": {"type": "string"},
                    "target": {"type": "string"},
                    "type": {"type": "string"},
                    "confidence": {"type": "number"},
                    "reason": {"type": "string"},
                    "evidence_quote": {"type": "string"},
                    "alternative_targets": {"type": "array", "items": {"type": "string"}},
                    "used_in_translation": {"type": "boolean"},
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
        "glossary_updates": options.glossary_updates,
        "locked_glossary": [_glossary_payload(entry) for entry in glossary if normalize_status(entry.status) == "locked"],
        "accepted_glossary": [
            _glossary_payload(entry)
            for entry in glossary
            if is_confirmed_entry(entry) and normalize_status(entry.status) != "locked"
        ],
        "candidate_terms": [_candidate_payload(entry) for entry in glossary if is_pending_entry(entry)],
        "previous_summary": previous_summary,
        "sections": [asdict(section) for section in episode.sections],
    }
    return json.dumps(payload, ensure_ascii=False, indent=2)


def _glossary_payload(entry: GlossaryEntry) -> dict[str, object]:
    payload = asdict(entry)
    return payload


def _candidate_payload(entry: GlossaryEntry) -> dict[str, object]:
    payload = asdict(entry)
    payload["target"] = ""
    payload["status"] = normalize_status(entry.status)
    payload["notes"] = f"{entry.notes}; candidate only, return a proposal if this term is used"
    return payload
