"""Glossary extraction, proposal validation, and safe merge management."""

from __future__ import annotations

import json
import re
import threading
from collections import defaultdict
from dataclasses import asdict, dataclass, fields, is_dataclass
from pathlib import Path
from typing import Any

from .models import (
    EpisodeText,
    GlossaryCandidate,
    GlossaryEntry,
    GlossaryProposal,
    MergeDecision,
    TermConflict,
    TermOccurrence,
)
from .utils import atomic_write_json, now_iso, read_json


TERM_RE = re.compile(r"[一-龯ァ-ヴー]{2,16}")
KATAKANA_RE = re.compile(r"[ァ-ヴー]{2,16}")
PHRASE_RE = re.compile(r"[一-龯ァ-ヴー]{1,8}の[一-龯ァ-ヴー]{1,8}")
RUBY_RE = re.compile(r"([一-龯ァ-ヴー]{1,16})[（(《]([ぁ-んァ-ヴーー]{1,24})[）》)]")
JAPANESE_RE = re.compile(r"[ぁ-んァ-ヴー一-龯]")
HANGUL_RE = re.compile(r"[가-힣]")
SENTENCE_MARK_RE = re.compile(r"[.!?。！？\n]")

V2_STATUSES = {
    "candidate",
    "proposed",
    "accepted_auto",
    "accepted_user",
    "locked",
    "forbidden",
    "deprecated",
    "needs_review",
}
LEGACY_STATUS_MAP = {
    "pending": "candidate",
    "approved": "accepted_auto",
    "rejected": "forbidden",
    "conflict": "needs_review",
}
ACTIVE_STATUSES = {"candidate", "proposed", "accepted_auto", "accepted_user", "locked", "needs_review"}
CONFIRMED_STATUSES = {"accepted_auto", "accepted_user", "locked", "approved"}
REVIEWABLE_STATUSES = {"candidate", "proposed", "needs_review", "pending", "conflict"}
SOURCE_SCORE_FLOOR = 0.45
SOURCE_SCORE_PROPOSAL = 0.70
SOURCE_SCORE_AUTO = 0.82


@dataclass(slots=True)
class ValidationResult:
    ok: bool
    reason: str = ""


class StopList:
    def __init__(self, exact: set[str] | None = None, prefixes: set[str] | None = None, regexes: list[re.Pattern[str]] | None = None) -> None:
        self.exact = exact or set()
        self.prefixes = prefixes or set()
        self.regexes = regexes or []

    @classmethod
    def load_default(cls) -> "StopList":
        root = Path(__file__).resolve().parent / "data"
        stoplist = cls()
        for path in (root / "stoplist-ja.txt", root / "stoplist-webnovel-ja.txt"):
            stoplist.extend(_read_stoplist(path))
        return stoplist

    def extend(self, other: "StopList") -> None:
        self.exact.update(other.exact)
        self.prefixes.update(other.prefixes)
        self.regexes.extend(other.regexes)

    def matches(self, value: str) -> bool:
        term = value.strip()
        if not term or term in self.exact:
            return True
        if any(term.startswith(prefix) for prefix in self.prefixes):
            return True
        return any(pattern.search(term) for pattern in self.regexes)


class CandidateMiner:
    """Mine source-side term candidates and keep evidence separate from acceptance."""

    def __init__(self, stoplist: StopList | None = None) -> None:
        self.stoplist = stoplist or StopList.load_default()

    def mine(self, episodes: list[EpisodeText]) -> list[GlossaryCandidate]:
        occurrences: dict[str, list[TermOccurrence]] = defaultdict(list)
        title_hits: set[str] = set()
        reasons: dict[str, set[str]] = defaultdict(set)

        for episode in episodes:
            for term, occurrence, reason in self._episode_occurrences(episode):
                normalized = normalize_source(term)
                if self.stoplist.matches(normalized):
                    continue
                occurrences[normalized].append(occurrence)
                reasons[normalized].add(reason)
                if occurrence.section_type == "title":
                    title_hits.add(normalized)

        candidates: list[GlossaryCandidate] = []
        total_episodes = max(1, len(episodes))
        for source, evidence in occurrences.items():
            if len(evidence) < 2 and source not in title_hits:
                continue
            episode_numbers = sorted({item.episode_no for item in evidence})
            candidate = GlossaryCandidate(
                source=source,
                normalized_source=source,
                type_hint=_guess_term_type(source),
                occurrence_count=len(evidence),
                episode_count=len(episode_numbers),
                first_seen_episode=episode_numbers[0],
                last_seen_episode=episode_numbers[-1],
                title_hit=source in title_hits,
                evidence=evidence[:10],
                reasons=sorted(reasons[source]),
            )
            candidate.source_score = score_candidate(candidate, total_episodes)
            if candidate.source_score >= SOURCE_SCORE_FLOOR:
                candidates.append(candidate)
        return sorted(candidates, key=lambda item: (-item.source_score, item.first_seen_episode, item.source))

    def _episode_occurrences(self, episode: EpisodeText) -> list[tuple[str, TermOccurrence, str]]:
        found: list[tuple[str, TermOccurrence, str]] = []
        found.extend(self._text_occurrences(episode.episode_no, "title", episode.title, "title"))
        for section in episode.sections:
            found.extend(self._text_occurrences(episode.episode_no, section.type, section.text, "cjk_compound"))
            found.extend(self._text_occurrences(episode.episode_no, section.type, section.text, "katakana", KATAKANA_RE))
            found.extend(self._text_occurrences(episode.episode_no, section.type, section.text, "repeated_phrase", PHRASE_RE))
            for match in RUBY_RE.finditer(section.text):
                term = match.group(1)
                found.append(
                    (
                        term,
                        _occurrence(episode.episode_no, section.type, section.text, match.start(1), match.end(1)),
                        "ruby",
                    )
                )
        return found

    def _text_occurrences(
        self,
        episode_no: int,
        section_type: str,
        text: str,
        reason: str,
        pattern: re.Pattern[str] = TERM_RE,
    ) -> list[tuple[str, TermOccurrence, str]]:
        return [
            (match.group(0), _occurrence(episode_no, section_type, text, match.start(), match.end()), reason)
            for match in pattern.finditer(text)
        ]


class GlossaryManager:
    def __init__(self, glossary_dir: Path) -> None:
        self.glossary_dir = glossary_dir
        self.path = glossary_dir / "glossary.json"
        self.locked_path = glossary_dir / "glossary.locked.json"
        self.forbidden_path = glossary_dir / "glossary.forbidden.json"
        self.candidates_path = glossary_dir / "candidates.json"
        self.proposals_path = glossary_dir / "proposals.jsonl"
        self.conflicts_path = glossary_dir / "conflicts.json"
        self.decisions_path = glossary_dir / "decisions.jsonl"
        self._lock = threading.Lock()
        self.entries: dict[str, GlossaryEntry] = {}
        self.conflicts: list[TermConflict] = []
        self.candidates: dict[str, GlossaryCandidate] = {}
        self.load()

    def load(self) -> None:
        self.glossary_dir.mkdir(parents=True, exist_ok=True)
        self.entries.clear()
        for payload in read_json(self.path, default=[]) or []:
            entry = _entry_from_payload(payload)
            if entry.source:
                self.entries[entry.source] = entry
        for payload in read_json(self.locked_path, default=[]) or []:
            entry = _entry_from_payload(payload, locked=True)
            if entry.source:
                self.entries[entry.source] = entry
        self._load_forbidden_rules()
        self.conflicts = [_conflict_from_payload(item) for item in read_json(self.conflicts_path, default=[]) or []]
        self.candidates = {
            candidate.source: candidate
            for candidate in (_candidate_from_payload(item) for item in read_json(self.candidates_path, default=[]) or [])
            if candidate.source
        }

    def save(self) -> None:
        regular = [
            asdict(entry)
            for entry in sorted(self.entries.values(), key=lambda item: item.source)
            if not entry.locked
        ]
        locked = [
            asdict(entry)
            for entry in sorted(self.entries.values(), key=lambda item: item.source)
            if entry.locked
        ]
        forbidden = [
            {"source": entry.source, "forbidden_targets": entry.forbidden_targets}
            for entry in sorted(self.entries.values(), key=lambda item: item.source)
            if entry.forbidden_targets
        ]
        atomic_write_json(self.path, regular)
        atomic_write_json(self.locked_path, locked)
        atomic_write_json(self.forbidden_path, forbidden)
        atomic_write_json(self.conflicts_path, [asdict(conflict) for conflict in self.conflicts])
        atomic_write_json(self.candidates_path, [asdict(candidate) for candidate in self.candidates.values()])

    def seed_from_episodes(self, episodes: list[EpisodeText]) -> list[GlossaryEntry]:
        mined = CandidateMiner().mine(episodes)
        created: list[GlossaryEntry] = []
        with self._lock:
            for candidate in mined:
                self.candidates[candidate.source] = candidate
                existing = self.entries.get(candidate.source)
                if existing:
                    _merge_candidate_into_entry(existing, candidate)
                    continue
                entry = GlossaryEntry(
                    source=candidate.source,
                    target="",
                    type=candidate.type_hint,
                    status="candidate",
                    confidence=0.0,
                    source_score=candidate.source_score,
                    locked=False,
                    occurrence_count=candidate.occurrence_count,
                    episode_count=candidate.episode_count,
                    first_seen_episode=candidate.first_seen_episode,
                    last_seen_episode=candidate.last_seen_episode,
                    evidence=candidate.evidence,
                    notes="auto-seeded from source evidence: " + ", ".join(candidate.reasons),
                    origin="auto",
                )
                self.entries[entry.source] = entry
                created.append(entry)
            if mined:
                self.save()
        return created

    def snapshot(self, limit: int = 200, include_inactive: bool = False) -> list[GlossaryEntry]:
        with self._lock:
            values = self.entries.values()
            if not include_inactive:
                values = [entry for entry in values if normalize_status(entry.status) in ACTIVE_STATUSES]
            entries = sorted(
                values,
                key=lambda item: (
                    normalize_status(item.status) != "locked",
                    normalize_status(item.status) not in {"accepted_user"},
                    normalize_status(item.status) not in {"accepted_auto"},
                    normalize_status(item.status) not in {"candidate", "proposed"},
                    -item.source_score,
                    -item.confidence,
                    item.source,
                ),
            )
            return list(entries[:limit])

    def update_from_terms(
        self,
        terms: list[GlossaryProposal | GlossaryEntry],
        *,
        episode: EpisodeText | None = None,
        strictness: str = "high",
        update_mode: str = "safe",
    ) -> list[TermConflict]:
        conflicts: list[TermConflict] = []
        effective_mode = glossary_update_mode(update_mode, strictness)
        episode_text = _episode_text_with_title(episode) if episode else ""
        with self._lock:
            for raw_term in terms:
                proposal = proposal_from_term(raw_term)
                if not proposal.source.strip() or not proposal.target.strip():
                    continue
                proposal.source = normalize_source(proposal.source)
                proposal.target = proposal.target.strip()
                self._append_proposal(proposal, episode)
                existing = self.entries.get(proposal.source)
                validation = validate_proposal(proposal, episode_text, existing)
                decision = decide_merge(existing, proposal, validation, strictness, effective_mode)
                conflict = self._apply_decision(proposal, decision)
                if isinstance(raw_term, GlossaryEntry) and proposal.source in self.entries:
                    _merge_entry_metadata_from_term(self.entries[proposal.source], raw_term)
                self._append_decision(proposal, decision, episode)
                if conflict:
                    conflicts.append(conflict)
            if terms or conflicts:
                self.save()
        return conflicts

    def add_or_update(self, entry: GlossaryEntry) -> None:
        with self._lock:
            entry = _normalize_entry(entry)
            if entry.origin == "auto" and normalize_status(entry.status) in {"accepted_user", "locked"}:
                entry.origin = "user"
            self.entries[entry.source] = entry
            self.save()

    def lock_term(self, source: str) -> bool:
        with self._lock:
            entry = self.entries.get(normalize_source(source))
            if not entry or not entry.target.strip() or entry.target.strip() == entry.source.strip():
                return False
            entry.locked = True
            entry.status = "locked"
            entry.origin = "user"
            self.save()
            return True

    def unlock_term(self, source: str) -> bool:
        with self._lock:
            entry = self.entries.get(normalize_source(source))
            if not entry:
                return False
            entry.locked = False
            entry.status = "accepted_user" if entry.target else "candidate"
            entry.origin = "user"
            self.save()
            return True

    def reject_term(self, source: str) -> bool:
        with self._lock:
            entry = self.entries.get(normalize_source(source))
            if not entry:
                return False
            entry.locked = False
            entry.status = "forbidden"
            entry.origin = "user"
            self.save()
            return True

    def forbid_target(self, source: str, target: str) -> bool:
        source = normalize_source(source)
        target = target.strip()
        if not source or not target:
            return False
        with self._lock:
            entry = self.entries.get(source)
            if not entry:
                entry = GlossaryEntry(source=source, status="forbidden", origin="user")
                self.entries[source] = entry
            entry.forbidden_targets = _merge_unique(entry.forbidden_targets, [target])
            if entry.target == target:
                entry.target = ""
                entry.status = "needs_review"
                entry.locked = False
            self.save()
            return True

    def set_user_target(self, source: str, target: str, *, lock: bool = False) -> bool:
        source = normalize_source(source)
        target = target.strip()
        if not source or not target or source == target:
            return False
        with self._lock:
            entry = self.entries.get(source)
            if not entry:
                entry = GlossaryEntry(source=source, origin="user")
                self.entries[source] = entry
            entry.target = target
            entry.status = "locked" if lock else "accepted_user"
            entry.locked = lock
            entry.confidence = max(entry.confidence, 1.0)
            entry.target_score = max(entry.target_score, 1.0)
            entry.origin = "user"
            self.conflicts = [conflict for conflict in self.conflicts if conflict.source != source]
            self.save()
            return True

    def pending_entries(self, limit: int = 100) -> list[GlossaryEntry]:
        with self._lock:
            pending = [entry for entry in self.entries.values() if is_pending_entry(entry)]
            return sorted(
                pending,
                key=lambda item: (
                    normalize_status(item.status) != "needs_review",
                    item.first_seen_episode or 999999,
                    -item.source_score,
                    item.source,
                ),
            )[:limit]

    def conflict_snapshot(self, limit: int = 100) -> list[TermConflict]:
        with self._lock:
            return list(self.conflicts[-limit:])

    def resolve_conflict(self, source: str, action: str) -> bool:
        source = normalize_source(source)
        with self._lock:
            matching = [conflict for conflict in self.conflicts if conflict.source == source]
            if not matching:
                return False
            conflict = matching[-1]
            entry = self.entries.get(source)
            if action in {"use_suggested", "new"}:
                if entry:
                    entry.target = conflict.suggested
                    entry.confidence = max(entry.confidence, 0.95)
                    entry.target_score = max(entry.target_score, 1.0)
                    entry.status = "accepted_user"
                    entry.locked = False
                    entry.origin = "user"
                else:
                    self.entries[source] = GlossaryEntry(
                        source=source,
                        target=conflict.suggested,
                        confidence=0.95,
                        target_score=1.0,
                        notes="resolved from conflict",
                        status="accepted_user",
                        origin="user",
                    )
            elif action in {"lock", "keep_and_lock"}:
                if not entry:
                    self.entries[source] = GlossaryEntry(
                        source=source,
                        target=conflict.previous,
                        confidence=0.95,
                        target_score=1.0,
                        locked=True,
                        notes="locked from conflict",
                        status="locked",
                        origin="user",
                    )
                else:
                    entry.locked = True
                    entry.status = "locked"
                    entry.origin = "user"
            elif action in {"keep_previous", "keep"}:
                if entry and normalize_status(entry.status) == "needs_review":
                    entry.status = "accepted_auto" if entry.target else "candidate"
            elif action in {"reject_source_target", "reject"}:
                if entry:
                    entry.status = "forbidden"
                    entry.locked = False
            else:
                return False
            self.conflicts = [conflict for conflict in self.conflicts if conflict.source != source]
            self.save()
            return True

    def _load_forbidden_rules(self) -> None:
        payload = read_json(self.forbidden_path, default=[]) or []
        if isinstance(payload, dict):
            payload = [{"source": source, "forbidden_targets": targets} for source, targets in payload.items()]
        for item in payload:
            if not isinstance(item, dict):
                continue
            source = normalize_source(str(item.get("source", "")))
            targets = _merge_unique(item.get("forbidden_targets", []), [])
            if not source or not targets:
                continue
            entry = self.entries.get(source) or GlossaryEntry(source=source, status="forbidden")
            entry.forbidden_targets = _merge_unique(entry.forbidden_targets, targets)
            self.entries[source] = _normalize_entry(entry)

    def _append_proposal(self, proposal: GlossaryProposal, episode: EpisodeText | None) -> None:
        _append_jsonl(
            self.proposals_path,
            {
                "created_at": now_iso(),
                "episode_no": episode.episode_no if episode else 0,
                "proposal": asdict(proposal),
            },
        )

    def _append_decision(
        self,
        proposal: GlossaryProposal,
        decision: MergeDecision,
        episode: EpisodeText | None,
    ) -> None:
        _append_jsonl(
            self.decisions_path,
            {
                "created_at": now_iso(),
                "episode_no": episode.episode_no if episode else 0,
                "source": proposal.source,
                "proposed_target": proposal.target,
                "action": decision.action,
                "safety": decision.safety,
                "reason": decision.reason,
                "conflict": asdict(decision.conflict) if decision.conflict else None,
            },
        )

    def _apply_decision(self, proposal: GlossaryProposal, decision: MergeDecision) -> TermConflict | None:
        if decision.action == "reject":
            if decision.conflict:
                self.conflicts.append(decision.conflict)
                return decision.conflict
            return None
        if decision.action == "keep":
            if decision.entry:
                self.entries[decision.entry.source] = _normalize_entry(decision.entry)
            return None
        if decision.action == "review":
            entry = decision.entry or _entry_from_proposal(proposal, status="proposed")
            self.entries[entry.source] = _normalize_entry(entry)
            return None
        if decision.action == "conflict":
            if decision.entry:
                self.entries[decision.entry.source] = _normalize_entry(decision.entry)
            if decision.conflict:
                self.conflicts.append(decision.conflict)
                return decision.conflict
            return None
        if decision.action in {"accept_safe", "accept_unsafe"}:
            if decision.entry:
                self.entries[decision.entry.source] = _normalize_entry(decision.entry)
            return None
        return None


def validate_proposal(
    proposal: GlossaryProposal,
    episode_text: str = "",
    existing: GlossaryEntry | None = None,
) -> ValidationResult:
    if episode_text and proposal.source not in episode_text:
        return ValidationResult(False, "source_not_found")
    if not proposal.target.strip():
        return ValidationResult(False, "empty_target")
    if proposal.source == proposal.target:
        return ValidationResult(False, "source_target_same")
    if is_stopword_source(proposal.source):
        return ValidationResult(False, "source_stopword")
    if existing and proposal.target in existing.forbidden_targets:
        return ValidationResult(False, "forbidden_target")
    if target_is_sentence_like(proposal.target):
        return ValidationResult(False, "target_sentence_like")
    if has_excessive_japanese(proposal.target):
        return ValidationResult(False, "target_japanese_leftover")
    if len(proposal.target) > max_target_length(proposal.source, proposal.type):
        return ValidationResult(False, "target_too_long")
    return ValidationResult(True)


def decide_merge(
    existing: GlossaryEntry | None,
    proposal: GlossaryProposal,
    validation: ValidationResult,
    strictness: str,
    update_mode: str,
) -> MergeDecision:
    if not validation.ok:
        return MergeDecision("reject", "none", validation.reason, conflict=_conflict_for_reject(proposal, validation.reason, existing))
    if update_mode == "off":
        return MergeDecision("keep", "none", "glossary_updates_off", existing)

    if existing is None:
        entry = _entry_from_proposal(proposal, status="proposed")
        if update_mode == "review":
            return MergeDecision("review", "none", "proposal_recorded_for_review", entry)
        if proposal_safe_enough(proposal, None, strictness):
            entry.status = "accepted_auto"
            entry.target_score = proposal.confidence
            return MergeDecision("accept_safe", "safe", "new_safe_proposal", entry)
        return MergeDecision("review", "none", "new_proposal_needs_review", entry)

    status = normalize_status(existing.status)
    if status in {"forbidden", "deprecated"}:
        return MergeDecision("reject", "none", f"existing_{status}", existing)

    if existing.locked or status == "locked":
        if proposal.target != existing.target:
            return MergeDecision(
                "conflict",
                "unsafe",
                "locked_conflict",
                existing,
                TermConflict(proposal.source, existing.target, proposal.target, "keep_previous", "locked_conflict"),
            )
        return MergeDecision("keep", "safe", "locked_target_reinforced", _strengthen(existing, proposal))

    if status == "accepted_user":
        if proposal.target != existing.target:
            return MergeDecision(
                "conflict",
                "unsafe",
                "user_accepted_conflict",
                existing,
                TermConflict(proposal.source, existing.target, proposal.target, "keep_previous", "user_accepted_conflict"),
            )
        return MergeDecision("keep", "safe", "user_target_reinforced", _strengthen(existing, proposal))

    if status in {"accepted_auto", "approved"}:
        if proposal.target == existing.target:
            return MergeDecision("keep", "safe", "auto_target_reinforced", _strengthen(existing, proposal))
        if update_mode == "unsafe":
            return MergeDecision(
                "accept_unsafe",
                "unsafe",
                "auto_accepted_replaced_by_opt_in",
                _replace_auto_target(existing, proposal),
            )
        return MergeDecision(
            "conflict",
            "unsafe",
            "auto_accepted_conflict",
            _mark_needs_review(existing),
            TermConflict(proposal.source, existing.target, proposal.target, "review", "auto_accepted_conflict"),
        )

    if status in {"candidate", "proposed", "needs_review", "pending", "conflict"}:
        if not existing.target:
            updated = _entry_from_proposal(proposal, status="proposed", existing=existing)
            if update_mode == "review":
                return MergeDecision("review", "none", "candidate_proposal_recorded", updated)
            if proposal_safe_enough(proposal, existing, strictness):
                updated.status = "accepted_auto"
                updated.target_score = proposal.confidence
                return MergeDecision("accept_safe", "safe", "candidate_promoted_safe", updated)
            return MergeDecision("review", "none", "candidate_proposal_needs_review", updated)
        if existing.target == proposal.target:
            updated = _strengthen(existing, proposal)
            if normalize_status(updated.status) in {"candidate", "proposed", "needs_review"} and proposal_safe_enough(proposal, existing, strictness):
                updated.status = "accepted_auto"
            return MergeDecision("keep", "safe", "candidate_target_reinforced", updated)
        if update_mode == "unsafe":
            return MergeDecision(
                "accept_unsafe",
                "unsafe",
                "reviewable_target_replaced_by_opt_in",
                _replace_auto_target(existing, proposal),
            )
        return MergeDecision(
            "conflict",
            "unsafe",
            "candidate_target_conflict",
            _mark_needs_review(existing),
            TermConflict(proposal.source, existing.target, proposal.target, "review", "candidate_target_conflict"),
        )

    return MergeDecision("review", "none", "unhandled_status", _mark_needs_review(existing))


def proposal_safe_enough(proposal: GlossaryProposal, existing: GlossaryEntry | None, strictness: str) -> bool:
    if not HANGUL_RE.search(proposal.target):
        return False
    thresholds = {
        "low": 1.1,
        "medium": 0.72,
        "high": 0.78,
        "strict": 0.84,
    }
    threshold = thresholds.get(strictness, thresholds["high"])
    if proposal.confidence < threshold:
        return False
    if existing is None:
        return proposal.confidence >= max(threshold, 0.82)
    if existing.source_score and existing.source_score < SOURCE_SCORE_FLOOR:
        return False
    return True


def score_candidate(candidate: GlossaryCandidate, total_episodes: int) -> float:
    frequency_score = min(1.0, candidate.occurrence_count / 2)
    spread_denominator = max(1, min(2, total_episodes))
    episode_spread_score = min(1.0, candidate.episode_count / spread_denominator)
    title_or_heading_score = 1.0 if candidate.title_hit else 0.0
    suffix_type_score = _suffix_type_score(candidate.source)
    proper_noun_shape_score = _proper_noun_shape_score(candidate.source)
    context_role_score = 0.5 if {"ruby", "repeated_phrase"} & set(candidate.reasons) else 0.0
    stopword_penalty = 1.0 if is_stopword_source(candidate.source) else 0.0
    score = (
        0.22 * frequency_score
        + 0.18 * episode_spread_score
        + 0.16 * title_or_heading_score
        + 0.14 * suffix_type_score
        + 0.12 * proper_noun_shape_score
        + 0.10 * context_role_score
        - 0.20 * stopword_penalty
    )
    return max(0.0, min(1.0, round(score, 4)))


def proposal_from_term(term: GlossaryProposal | GlossaryEntry) -> GlossaryProposal:
    if isinstance(term, GlossaryProposal):
        return term
    return GlossaryProposal(
        source=term.source,
        target=term.target,
        type=term.type,
        confidence=term.confidence,
        reason=term.notes,
        evidence_quote=_first_evidence_text(term.evidence),
        alternative_targets=list(term.variants),
        used_in_translation=True,
        proposer=term.origin or "model",
    )


def normalize_source(source: str) -> str:
    return re.sub(r"\s+", "", str(source).strip())


def normalize_status(status: str) -> str:
    value = str(status or "").strip()
    return LEGACY_STATUS_MAP.get(value, value if value in V2_STATUSES else "candidate")


def is_pending_auto_seed(entry: GlossaryEntry | object) -> bool:
    target = getattr(entry, "target", "")
    source = getattr(entry, "source", "")
    notes = getattr(entry, "notes", "")
    return (
        getattr(entry, "locked", False) is False
        and (normalize_status(str(getattr(entry, "status", ""))) == "candidate" or "auto-seeded" in str(notes))
        and (not str(target).strip() or str(target).strip() == str(source).strip())
    )


def is_pending_entry(entry: GlossaryEntry | object) -> bool:
    status = normalize_status(str(getattr(entry, "status", "")))
    target = str(getattr(entry, "target", "")).strip()
    source = str(getattr(entry, "source", "")).strip()
    if status == "candidate" and target and target != source:
        return False
    return status in REVIEWABLE_STATUSES or is_pending_auto_seed(entry)


def is_confirmed_entry(entry: GlossaryEntry | object) -> bool:
    source = str(getattr(entry, "source", "")).strip()
    target = str(getattr(entry, "target", "")).strip()
    status = normalize_status(str(getattr(entry, "status", "candidate")))
    return bool(
        source
        and target
        and source != target
        and (status in CONFIRMED_STATUSES or status == "candidate")
        and not is_pending_auto_seed(entry)
    )


def source_terms(entry: GlossaryEntry) -> list[str]:
    return _merge_unique([entry.source], entry.aliases)


def entry_applies_to_episode(entry: GlossaryEntry, episode_no: int) -> bool:
    if entry.episode_start and episode_no < entry.episode_start:
        return False
    if entry.episode_end and episode_no > entry.episode_end:
        return False
    return True


def is_stopword_source(source: str) -> bool:
    return StopList.load_default().matches(source)


def target_is_sentence_like(target: str) -> bool:
    stripped = target.strip()
    if SENTENCE_MARK_RE.search(stripped):
        return True
    return len(stripped.split()) >= 5


def has_excessive_japanese(target: str) -> bool:
    matches = JAPANESE_RE.findall(target)
    if not matches:
        return False
    return len(matches) >= 4 or len(matches) / max(1, len(target)) > 0.35


def max_target_length(source: str, term_type: str) -> int:
    base = max(12, int(len(source) * 2.5) + 6)
    if term_type in {"description", "title"}:
        return base + 12
    return base


def glossary_update_mode(update_mode: str, strictness: str) -> str:
    mode = str(update_mode or "safe").strip().lower()
    if mode not in {"off", "safe", "review", "unsafe"}:
        mode = "safe"
    if strictness == "low":
        return "off"
    if strictness == "strict" and mode == "unsafe":
        return "safe"
    return mode


def _read_stoplist(path: Path) -> StopList:
    stoplist = StopList()
    if not path.exists():
        return stoplist
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("="):
            stoplist.exact.add(line[1:].strip())
        elif line.startswith(">"):
            stoplist.prefixes.add(line[1:].strip())
        elif line.startswith("/") and line.endswith("/") and len(line) > 2:
            try:
                stoplist.regexes.append(re.compile(line[1:-1]))
            except re.error:
                continue
        else:
            stoplist.exact.add(line)
    return stoplist


def _occurrence(episode_no: int, section_type: str, text: str, start: int, end: int) -> TermOccurrence:
    return TermOccurrence(
        episode_no=episode_no,
        section_type=section_type,
        start=start,
        end=end,
        text=text[start:end],
        context_before=text[max(0, start - 24):start],
        context_after=text[end:end + 24],
    )


def _guess_term_type(term: str) -> str:
    if term.endswith(("団", "会", "機関", "組", "協会", "学院")):
        return "organization"
    if term.endswith(("王都", "町", "村", "国", "城", "砦", "帝国")) or term.startswith(("王都", "帝国")):
        return "place"
    if term.endswith(("剣", "槍", "魔法", "術", "聖剣", "魔石")):
        return "skill"
    if term.endswith(("姫", "王", "騎士", "殺し", "聖")):
        return "title"
    return "proper_noun"


def _suffix_type_score(term: str) -> float:
    if _guess_term_type(term) != "proper_noun":
        return 1.0
    return 0.0


def _proper_noun_shape_score(term: str) -> float:
    has_kanji = bool(re.search(r"[一-龯]", term))
    has_katakana = bool(re.search(r"[ァ-ヴー]", term))
    if has_kanji and has_katakana:
        return 1.0
    if has_katakana and len(term) >= 3:
        return 0.85
    if has_kanji and len(term) >= 2:
        return 0.65
    return 0.0


def _merge_candidate_into_entry(entry: GlossaryEntry, candidate: GlossaryCandidate) -> None:
    entry.source_score = max(entry.source_score, candidate.source_score)
    entry.occurrence_count = max(entry.occurrence_count, candidate.occurrence_count)
    entry.episode_count = max(entry.episode_count, candidate.episode_count)
    if not entry.first_seen_episode or candidate.first_seen_episode < entry.first_seen_episode:
        entry.first_seen_episode = candidate.first_seen_episode
    entry.last_seen_episode = max(entry.last_seen_episode, candidate.last_seen_episode)
    entry.evidence = _merge_evidence(entry.evidence, candidate.evidence)
    if not entry.type or entry.type == "unknown":
        entry.type = candidate.type_hint


def _merge_entry_metadata_from_term(entry: GlossaryEntry, term: GlossaryEntry) -> None:
    if term.reading:
        entry.reading = term.reading
    if term.type and term.type != "unknown":
        entry.type = term.type
    entry.aliases = _merge_unique(entry.aliases, term.aliases)
    entry.variants = _merge_unique(entry.variants, term.variants)
    entry.forbidden_targets = _merge_unique(entry.forbidden_targets, term.forbidden_targets)
    entry.evidence = _merge_evidence(entry.evidence, term.evidence)
    if term.first_seen_episode and not entry.first_seen_episode:
        entry.first_seen_episode = term.first_seen_episode
    if term.last_seen_episode:
        entry.last_seen_episode = max(entry.last_seen_episode, term.last_seen_episode)
    entry.occurrence_count = max(entry.occurrence_count, term.occurrence_count)
    entry.episode_count = max(entry.episode_count, term.episode_count)


def _entry_from_proposal(
    proposal: GlossaryProposal,
    *,
    status: str,
    existing: GlossaryEntry | None = None,
) -> GlossaryEntry:
    entry = existing or GlossaryEntry(source=proposal.source)
    entry.source = normalize_source(proposal.source)
    entry.target = proposal.target.strip()
    entry.type = proposal.type or entry.type or "unknown"
    entry.status = status
    entry.confidence = max(entry.confidence, proposal.confidence)
    entry.target_score = max(entry.target_score, proposal.confidence)
    entry.notes = _append_note(entry.notes, proposal.reason)
    entry.origin = "auto" if proposal.proposer in {"model", "rule"} else proposal.proposer
    if proposal.evidence_quote:
        entry.evidence = _merge_evidence(
            entry.evidence,
            [TermOccurrence(0, "body", -1, -1, proposal.source, "", proposal.evidence_quote)],
        )
    entry.variants = _merge_unique(entry.variants, proposal.alternative_targets)
    return entry


def _strengthen(entry: GlossaryEntry, proposal: GlossaryProposal) -> GlossaryEntry:
    entry.confidence = max(entry.confidence, proposal.confidence)
    entry.target_score = max(entry.target_score, proposal.confidence)
    entry.notes = _append_note(entry.notes, proposal.reason)
    entry.variants = _merge_unique(entry.variants, proposal.alternative_targets)
    return entry


def _mark_needs_review(entry: GlossaryEntry) -> GlossaryEntry:
    if normalize_status(entry.status) not in {"locked", "accepted_user"}:
        entry.status = "needs_review"
    return entry


def _replace_auto_target(entry: GlossaryEntry, proposal: GlossaryProposal) -> GlossaryEntry:
    entry.target = proposal.target
    entry.type = proposal.type or entry.type
    entry.status = "accepted_auto"
    entry.locked = False
    entry.confidence = max(entry.confidence, proposal.confidence)
    entry.target_score = max(entry.target_score, proposal.confidence)
    entry.notes = _append_note(entry.notes, "unsafe opt-in target replacement")
    entry.notes = _append_note(entry.notes, proposal.reason)
    entry.variants = _merge_unique(entry.variants, proposal.alternative_targets)
    return entry


def _conflict_for_reject(
    proposal: GlossaryProposal,
    reason: str,
    existing: GlossaryEntry | None,
) -> TermConflict | None:
    if reason in {"source_target_same", "forbidden_target"}:
        return TermConflict(
            proposal.source,
            existing.target if existing else "",
            proposal.target,
            "reject_source_target" if reason == "source_target_same" else "keep_previous",
            reason,
        )
    return None


def _entry_from_payload(payload: dict[str, Any], locked: bool = False) -> GlossaryEntry:
    if not isinstance(payload, dict):
        payload = {}
    values = _filter_dataclass_fields(GlossaryEntry, payload)
    values["evidence"] = [_occurrence_from_payload(item) for item in payload.get("evidence", []) if isinstance(item, dict)]
    entry = GlossaryEntry(**values)
    if locked:
        entry.locked = True
        entry.status = "locked"
    return _normalize_entry(entry)


def _candidate_from_payload(payload: dict[str, Any]) -> GlossaryCandidate:
    if not isinstance(payload, dict):
        payload = {}
    values = _filter_dataclass_fields(GlossaryCandidate, payload)
    values["evidence"] = [_occurrence_from_payload(item) for item in payload.get("evidence", []) if isinstance(item, dict)]
    return GlossaryCandidate(**values)


def _occurrence_from_payload(payload: dict[str, Any]) -> TermOccurrence:
    values = _filter_dataclass_fields(TermOccurrence, payload)
    return TermOccurrence(**values)


def _conflict_from_payload(payload: dict[str, Any]) -> TermConflict:
    if not isinstance(payload, dict):
        payload = {}
    values = _filter_dataclass_fields(TermConflict, payload)
    return TermConflict(**values)


def _filter_dataclass_fields(cls: type, payload: dict[str, Any]) -> dict[str, Any]:
    names = {field.name for field in fields(cls)}
    return {key: value for key, value in payload.items() if key in names}


def _normalize_entry(entry: GlossaryEntry) -> GlossaryEntry:
    entry.source = normalize_source(entry.source)
    entry.target = entry.target.strip()
    entry.type = entry.type.strip() or "unknown"
    entry.reading = entry.reading.strip()
    entry.notes = entry.notes.strip()
    entry.speaker = entry.speaker.strip()
    entry.origin = entry.origin.strip() or "auto"
    entry.status = normalize_status(entry.status)  # type: ignore[assignment]
    entry.aliases = [item for item in _merge_unique(entry.aliases, []) if item != entry.source]
    entry.variants = _merge_unique(entry.variants, [])
    entry.forbidden_targets = _merge_unique(entry.forbidden_targets, [])
    entry.evidence = [_occurrence_from_any(item) for item in entry.evidence]
    if entry.source and entry.target == entry.source:
        entry.target = ""
        entry.status = "candidate"
        entry.locked = False
        entry.notes = _append_note(entry.notes, "target reset because source and target matched")
    if entry.locked or entry.status == "locked":
        entry.locked = True
        entry.status = "locked"
    elif not entry.target and entry.status in {"accepted_auto", "accepted_user", "approved"}:
        entry.status = "candidate"
        entry.locked = False
    elif entry.target and entry.status == "candidate":
        entry.status = "accepted_auto"
    if entry.status == "accepted_user":
        entry.origin = "user"
    return entry


def _occurrence_from_any(value: TermOccurrence | dict[str, Any]) -> TermOccurrence:
    if isinstance(value, TermOccurrence):
        return value
    if isinstance(value, dict):
        return _occurrence_from_payload(value)
    return TermOccurrence(0, "body", 0, 0, str(value))


def _merge_evidence(primary: object, secondary: object) -> list[TermOccurrence]:
    seen: set[tuple[int, str, int, int, str]] = set()
    values: list[TermOccurrence] = []
    for raw in [*_iter_values(primary), *_iter_values(secondary)]:
        occurrence = _occurrence_from_any(raw)  # type: ignore[arg-type]
        key = (occurrence.episode_no, occurrence.section_type, occurrence.start, occurrence.end, occurrence.text)
        if key in seen:
            continue
        seen.add(key)
        values.append(occurrence)
    return values[:20]


def _merge_unique(primary: object, secondary: object) -> list[str]:
    seen: set[str] = set()
    values: list[str] = []
    for raw in [*_iter_values(primary), *_iter_values(secondary)]:
        value = str(raw).strip()
        if not value or value in seen:
            continue
        seen.add(value)
        values.append(value)
    return values


def _iter_values(value: object) -> list[object]:
    if isinstance(value, list | tuple | set):
        return list(value)
    if isinstance(value, str):
        return [item.strip() for item in value.split(",")]
    if is_dataclass(value):
        return [value]
    return []


def _append_note(notes: str, addition: str) -> str:
    addition = addition.strip()
    if not addition or addition in notes:
        return notes
    return (notes + "; " if notes else "") + addition


def _first_evidence_text(evidence: list[TermOccurrence]) -> str:
    return evidence[0].text if evidence else ""


def _episode_text_with_title(episode: EpisodeText | None) -> str:
    if not episode:
        return ""
    return episode.title + "\n" + episode.all_text()


def _append_jsonl(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(payload, ensure_ascii=False) + "\n")
