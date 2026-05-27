"""Token and cost estimation helpers."""

from __future__ import annotations

from dataclasses import asdict, dataclass

from .models import EpisodeText, TranslationOptions


@dataclass(slots=True)
class Estimate:
    episode_count: int
    source_chars: int
    estimated_input_tokens: int
    estimated_output_tokens: int
    estimated_total_tokens: int
    model: str
    estimated_cost: float | None = None
    currency: str = "USD"
    pricing_note: str = "가격표는 시간에 따라 변하므로 토큰만 추정합니다."

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


def estimate_translation(
    episodes: list[EpisodeText],
    options: TranslationOptions,
    input_price_per_million_tokens: float = 0.0,
    output_price_per_million_tokens: float = 0.0,
) -> Estimate:
    source_chars = sum(len(episode.title) + len(episode.all_text()) for episode in episodes)
    if not episodes:
        estimated_input_tokens = 0
        estimated_output_tokens = 0
    else:
        estimated_input_tokens = max(1, int(source_chars / 2.2))
        estimated_output_tokens = max(1, int(source_chars / 1.8))
    estimated_cost = None
    pricing_note = "가격표는 시간에 따라 변하므로 토큰만 추정합니다."
    if input_price_per_million_tokens or output_price_per_million_tokens:
        estimated_cost = (
            estimated_input_tokens * input_price_per_million_tokens
            + estimated_output_tokens * output_price_per_million_tokens
        ) / 1_000_000
        pricing_note = "사용자 설정 단가 기준의 대략적 비용 추정입니다."
    return Estimate(
        episode_count=len(episodes),
        source_chars=source_chars,
        estimated_input_tokens=estimated_input_tokens,
        estimated_output_tokens=estimated_output_tokens,
        estimated_total_tokens=estimated_input_tokens + estimated_output_tokens,
        model=options.model,
        estimated_cost=estimated_cost,
        pricing_note=pricing_note,
    )
