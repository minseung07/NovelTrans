"""Quality checks for translated episodes."""

from __future__ import annotations

import re

from .glossary import is_pending_auto_seed
from .models import EpisodeText, GlossaryEntry, QAIssue, TranslationResult
from .utils import paragraph_count


JAPANESE_RE = re.compile(r"[ぁ-んァ-ン一-龯]")
NUMBER_RE = re.compile(r"\d+")
HANGUL_RE = re.compile(r"[가-힣]")
POLITE_SPEECH_RE = re.compile(r"(요|습니다|습니까|세요|예요|이에요|입니다|입니까)[.!?…」”\"']*$")
CASUAL_SPEECH_RE = re.compile(r"(다|냐|니|라|군|네|지|해|해라|하자)[.!?…」”\"']*$")
QUOTED_SPEECH_RE = re.compile(r"[「『“\"]([^」』”\"]{2,240})[」』”\"]")
HANGUL_BASE = 0xAC00
HANGUL_END = 0xD7A3
HANGUL_MEDIALS = 21
HANGUL_FINALS = 28
MEDIAL_VARIANTS = {
    0: (1, 4),  # ㅏ -> ㅐ, ㅓ
    1: (0, 5),  # ㅐ -> ㅏ, ㅔ
    4: (0, 5),  # ㅓ -> ㅏ, ㅔ
    5: (1, 4),  # ㅔ -> ㅐ, ㅓ
    8: (13,),  # ㅗ -> ㅜ
    13: (8, 18),  # ㅜ -> ㅗ, ㅡ
    18: (13,),  # ㅡ -> ㅜ
    20: (16,),  # ㅣ -> ㅟ
}


class QAEngine:
    def run(
        self,
        source: EpisodeText,
        result: TranslationResult,
        glossary: list[GlossaryEntry],
        banned_terms: list[str] | None = None,
        check_missing_paragraphs: bool = True,
        compare_length_ratio: bool = True,
        check_term_consistency: bool = True,
    ) -> list[QAIssue]:
        issues: list[QAIssue] = []
        translated = "\n\n".join(
            part for part in (result.foreword_ko, result.body_ko, result.afterword_ko) if part.strip()
        )
        source_text = source.all_text()

        if check_missing_paragraphs:
            source_count = paragraph_count(source_text)
            target_count = paragraph_count(translated)
            if source_count and target_count < max(1, int(source_count * 0.6)):
                issues.append(
                    QAIssue(
                        episode_no=source.episode_no,
                        severity="warning",
                        code="missing_paragraphs",
                        message=f"번역 문단 수가 원문 대비 적습니다: source={source_count}, target={target_count}",
                    )
                )

        if compare_length_ratio and source_text and translated:
            ratio = len(translated) / max(1, len(source_text))
            if ratio < 0.25 or ratio > 3.5:
                issues.append(
                    QAIssue(
                        episode_no=source.episode_no,
                        severity="warning",
                        code="length_ratio",
                        message=f"원문 대비 번역 길이 비율이 비정상적입니다: {ratio:.2f}",
                    )
                )

        source_numbers = set(NUMBER_RE.findall(source_text))
        target_numbers = set(NUMBER_RE.findall(translated))
        missing_numbers = sorted(source_numbers - target_numbers)
        if missing_numbers:
            issues.append(
                QAIssue(
                    episode_no=source.episode_no,
                    severity="info",
                    code="numbers_missing",
                    message=f"번역에서 누락된 숫자 후보: {', '.join(missing_numbers[:10])}",
                )
            )

        leftovers = JAPANESE_RE.findall(translated)
        if len(leftovers) > 20:
            issues.append(
                QAIssue(
                    episode_no=source.episode_no,
                    severity="warning",
                    code="japanese_leftover",
                    message="번역문에 일본어 원문이 많이 남아 있습니다.",
                )
            )

        if check_term_consistency:
            for entry in glossary:
                if is_pending_auto_seed(entry):
                    continue
                if entry.source in source_text and entry.target and entry.target not in translated:
                    issues.append(
                        QAIssue(
                            episode_no=source.episode_no,
                            severity="info",
                            code="glossary_target_missing",
                            message=f"용어집 권장 번역이 보이지 않습니다: {entry.source} -> {entry.target}",
                            auto_fixable=False,
                        )
                    )
                variant_matches = _target_variant_matches(translated, entry.target)
                if len(variant_matches) >= 2:
                    issues.append(
                        QAIssue(
                            episode_no=source.episode_no,
                            severity="info",
                            code="name_variant",
                            message=(
                                f"용어 표기 흔들림 후보: {entry.source} -> "
                                + ", ".join(variant_matches[:6])
                            ),
                            auto_fixable=False,
                        )
                    )

        speech_issue = _speech_style_issue(source.episode_no, translated)
        if speech_issue:
            issues.append(speech_issue)

        for term in banned_terms or []:
            if term and term in translated:
                issues.append(
                    QAIssue(
                        episode_no=source.episode_no,
                        severity="warning",
                        code="banned_term",
                        message=f"금칙어가 번역문에 포함되어 있습니다: {term}",
                    )
                )
        return issues


def _target_variant_matches(translated: str, target: str) -> list[str]:
    target = target.strip()
    if len(target) < 2 or not HANGUL_RE.search(target):
        return []
    candidates = [target]
    candidates.extend(_spacing_variants(target))
    candidates.extend(_hangul_vowel_variants(target))
    seen: set[str] = set()
    matches: list[str] = []
    for candidate in candidates:
        if candidate in seen:
            continue
        seen.add(candidate)
        if candidate and candidate in translated:
            matches.append(candidate)
    return matches


def _spacing_variants(target: str) -> list[str]:
    if " " in target:
        return [target.replace(" ", "")]
    variants: list[str] = []
    if len(target) >= 4:
        for index in range(2, len(target) - 1):
            variants.append(target[:index] + " " + target[index:])
    return variants


def _hangul_vowel_variants(target: str) -> list[str]:
    variants: list[str] = []
    for index, char in enumerate(target):
        code = ord(char)
        if code < HANGUL_BASE or code > HANGUL_END:
            continue
        offset = code - HANGUL_BASE
        leading = offset // (HANGUL_MEDIALS * HANGUL_FINALS)
        medial = (offset // HANGUL_FINALS) % HANGUL_MEDIALS
        final = offset % HANGUL_FINALS
        for new_medial in MEDIAL_VARIANTS.get(medial, ()):
            new_code = HANGUL_BASE + (leading * HANGUL_MEDIALS + new_medial) * HANGUL_FINALS + final
            variants.append(target[:index] + chr(new_code) + target[index + 1 :])
            if len(variants) >= 40:
                return variants
    return variants


def _speech_style_issue(episode_no: int, translated: str) -> QAIssue | None:
    polite = 0
    casual = 0
    for segment in _quoted_speech_segments(translated):
        stripped = segment.strip()
        if POLITE_SPEECH_RE.search(stripped):
            polite += 1
        elif CASUAL_SPEECH_RE.search(stripped):
            casual += 1
    if polite >= 2 and casual >= 2:
        return QAIssue(
            episode_no=episode_no,
            severity="info",
            code="speech_style_mixed",
            message=f"대사에서 존댓말/반말 혼재 후보가 있습니다: polite={polite}, casual={casual}",
            auto_fixable=False,
        )
    return None


def _quoted_speech_segments(translated: str) -> list[str]:
    segments = [match.group(1) for match in QUOTED_SPEECH_RE.finditer(translated)]
    if segments:
        return segments
    return [
        line.strip()
        for line in translated.splitlines()
        if line.strip().startswith(("-", "「", "『", '"', "“"))
    ]
