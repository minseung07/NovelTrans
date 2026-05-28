"""Dataclasses for the NovelTrans workflow."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Literal


PolicyGrade = Literal["A", "B", "C", "D"]
SectionType = Literal["foreword", "body", "afterword"]
GlossaryStatus = Literal[
    "candidate",
    "proposed",
    "accepted_auto",
    "accepted_user",
    "locked",
    "forbidden",
    "deprecated",
    "needs_review",
    "pending",
    "approved",
    "rejected",
    "conflict",
]
GlossaryUpdateMode = Literal["off", "safe", "review", "unsafe"]
GlossaryMatchingPolicy = Literal["exact", "spacing_flexible", "suffix_allowed", "alias_allowed", "contextual"]


@dataclass(slots=True)
class TermOccurrence:
    episode_no: int
    section_type: str
    start: int
    end: int
    text: str
    context_before: str = ""
    context_after: str = ""


@dataclass(slots=True)
class GlossaryCandidate:
    source: str
    normalized_source: str
    type_hint: str = "unknown"
    occurrence_count: int = 0
    episode_count: int = 0
    first_seen_episode: int = 0
    last_seen_episode: int = 0
    title_hit: bool = False
    source_score: float = 0.0
    evidence: list[TermOccurrence] = field(default_factory=list)
    reasons: list[str] = field(default_factory=list)


@dataclass(slots=True)
class GlossaryProposal:
    source: str
    target: str
    type: str = "unknown"
    confidence: float = 0.5
    reason: str = ""
    evidence_quote: str = ""
    alternative_targets: list[str] = field(default_factory=list)
    used_in_translation: bool = False
    proposer: str = "model"


@dataclass(slots=True)
class ConnectorPolicy:
    site_name: str
    grade: PolicyGrade
    auto_fetch_allowed: bool
    requires_official_api: bool
    requires_user_permission: bool
    supports_login: bool
    max_rps: float
    notes: str
    allowed_input_modes: list[str] = field(default_factory=list)


@dataclass(slots=True)
class WorkMetadata:
    title: str
    author: str = ""
    source_url: str = ""
    site: str = "local"
    work_id: str = ""
    license_note: str = ""
    collected_at: str = ""
    extra: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class EpisodeMetadata:
    episode_no: int
    title: str
    url: str = ""
    source_id: str = ""


@dataclass(slots=True)
class Section:
    type: SectionType
    text: str


@dataclass(slots=True)
class EpisodeText:
    episode_no: int
    title: str
    sections: list[Section]
    source_url: str = ""
    source_hash: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)

    def all_text(self) -> str:
        return "\n\n".join(section.text for section in self.sections if section.text.strip())


@dataclass(slots=True)
class GlossaryEntry:
    source: str
    target: str = ""
    type: str = "unknown"
    reading: str = ""
    status: GlossaryStatus = "candidate"
    confidence: float = 0.0
    source_score: float = 0.0
    target_score: float = 0.0
    locked: bool = False
    priority: bool = False
    aliases: list[str] = field(default_factory=list)
    variants: list[str] = field(default_factory=list)
    forbidden_targets: list[str] = field(default_factory=list)
    occurrence_count: int = 0
    episode_count: int = 0
    first_seen_episode: int = 0
    last_seen_episode: int = 0
    evidence: list[TermOccurrence] = field(default_factory=list)
    origin: str = "auto"
    notes: str = ""
    episode_start: int = 0
    episode_end: int = 0
    speaker: str = ""
    matching_policy: GlossaryMatchingPolicy = "exact"


@dataclass(slots=True)
class TermConflict:
    source: str
    previous: str
    suggested: str
    recommendation: str = "keep_previous"
    reason: str = ""


@dataclass(slots=True)
class MergeDecision:
    action: str
    safety: str
    reason: str
    entry: GlossaryEntry | None = None
    conflict: TermConflict | None = None


@dataclass(slots=True)
class TranslationOptions:
    model: str = "gpt-5.5"
    backend: str = "openai"
    reasoning_effort: str = "medium"
    style: str = "korean_webnovel_balanced"
    honorific_policy: str = "adaptive"
    preserve_japanese_suffixes: bool = False
    translate_author_notes: bool = True
    keep_ruby_as_parentheses: bool = False
    glossary_strictness: str = "high"
    glossary_updates: GlossaryUpdateMode = "safe"
    temperature: float | None = 0.3
    preset: str = "balanced"


@dataclass(slots=True)
class ParallelOptions:
    max_parallel_episodes: int = 4
    one_episode_per_worker: bool = True
    split_long_episode: bool = False
    long_episode_threshold_chars: int = 20000
    retries: int = 2


@dataclass(slots=True)
class QualityOptions:
    run_qa_pass: bool = True
    run_term_consistency_pass: bool = True
    check_missing_paragraphs: bool = True
    compare_length_ratio: bool = True
    banned_terms: list[str] = field(default_factory=list)


@dataclass(slots=True)
class ExportOptions:
    formats: list[str] = field(default_factory=lambda: ["txt", "epub"])
    include_glossary: bool = True
    include_author_notes: bool = True
    watermark: str = "개인 번역본 / 재배포 금지 / 원저작권은 원작자에게 있음"
    epub_vertical_writing: bool = False


@dataclass(slots=True)
class TranslationResult:
    title_ko: str
    body_ko: str
    foreword_ko: str = ""
    afterword_ko: str = ""
    new_terms: list[GlossaryProposal | GlossaryEntry] = field(default_factory=list)
    term_conflicts: list[TermConflict] = field(default_factory=list)
    episode_summary: str = ""
    qa_notes: list[str] = field(default_factory=list)
    raw_response: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class QAIssue:
    episode_no: int
    severity: str
    code: str
    message: str
    auto_fixable: bool = False


@dataclass(slots=True)
class ProjectManifest:
    name: str
    slug: str
    work: WorkMetadata
    translation: TranslationOptions
    parallel: ParallelOptions
    quality: QualityOptions
    export: ExportOptions
    created_at: str
    updated_at: str
    source_policy: ConnectorPolicy | None = None

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        return data
