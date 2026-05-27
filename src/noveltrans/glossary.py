"""Glossary extraction and management."""

from __future__ import annotations

import re
import threading
from collections import Counter
from dataclasses import asdict
from pathlib import Path

from .models import EpisodeText, GlossaryEntry, TermConflict
from .utils import atomic_write_json, read_json


TERM_RE = re.compile(r"[一-龯ァ-ヴー]{2,16}")


class GlossaryManager:
    def __init__(self, glossary_dir: Path) -> None:
        self.glossary_dir = glossary_dir
        self.path = glossary_dir / "glossary.json"
        self.locked_path = glossary_dir / "glossary.locked.json"
        self.conflicts_path = glossary_dir / "conflicts.json"
        self._lock = threading.Lock()
        self.entries: dict[str, GlossaryEntry] = {}
        self.conflicts: list[TermConflict] = []
        self.load()

    def load(self) -> None:
        self.glossary_dir.mkdir(parents=True, exist_ok=True)
        self.entries.clear()
        for payload in read_json(self.path, default=[]) or []:
            entry = GlossaryEntry(**payload)
            if is_pending_auto_seed(entry):
                entry.target = ""
            self.entries[entry.source] = entry
        for payload in read_json(self.locked_path, default=[]) or []:
            entry = GlossaryEntry(**payload)
            entry.locked = True
            self.entries[entry.source] = entry
        self.conflicts = [TermConflict(**item) for item in read_json(self.conflicts_path, default=[]) or []]

    def save(self) -> None:
        regular = [asdict(entry) for entry in sorted(self.entries.values(), key=lambda item: item.source) if not entry.locked]
        locked = [asdict(entry) for entry in sorted(self.entries.values(), key=lambda item: item.source) if entry.locked]
        atomic_write_json(self.path, regular)
        atomic_write_json(self.locked_path, locked)
        atomic_write_json(self.conflicts_path, [asdict(conflict) for conflict in self.conflicts])

    def seed_from_episodes(self, episodes: list[EpisodeText]) -> list[GlossaryEntry]:
        counter: Counter[str] = Counter()
        first_seen: dict[str, int] = {}
        for episode in episodes:
            for term in TERM_RE.findall(episode.all_text()):
                if _looks_like_noise(term):
                    continue
                counter[term] += 1
                first_seen.setdefault(term, episode.episode_no)
        created: list[GlossaryEntry] = []
        with self._lock:
            for source, count in counter.items():
                if count < 2 or source in self.entries:
                    continue
                entry = GlossaryEntry(
                    source=source,
                    target="",
                    type=_guess_term_type(source),
                    confidence=min(0.9, 0.45 + count * 0.05),
                    locked=False,
                    first_seen_episode=first_seen[source],
                    notes="auto-seeded from repeated source terms",
                )
                self.entries[source] = entry
                created.append(entry)
            if created:
                self.save()
        return created

    def snapshot(self, limit: int = 200) -> list[GlossaryEntry]:
        with self._lock:
            entries = sorted(
                self.entries.values(),
                key=lambda item: (not item.locked, -item.confidence, item.source),
            )
            return list(entries[:limit])

    def update_from_terms(self, terms: list[GlossaryEntry]) -> list[TermConflict]:
        conflicts: list[TermConflict] = []
        with self._lock:
            for term in terms:
                if not term.source.strip() or not term.target.strip():
                    continue
                existing = self.entries.get(term.source)
                if existing:
                    if existing.target != term.target:
                        if is_pending_auto_seed(existing):
                            existing.target = term.target
                            existing.type = term.type or existing.type
                            existing.confidence = max(existing.confidence, term.confidence)
                            existing.notes = term.notes or existing.notes
                            continue
                        conflict = TermConflict(
                            source=term.source,
                            previous=existing.target,
                            suggested=term.target,
                            recommendation="keep_previous" if existing.locked else "review",
                        )
                        conflicts.append(conflict)
                        self.conflicts.append(conflict)
                        if not existing.locked and term.confidence > existing.confidence:
                            existing.target = term.target
                            existing.confidence = term.confidence
                            existing.notes = term.notes or existing.notes
                    continue
                self.entries[term.source] = term
            if terms or conflicts:
                self.save()
        return conflicts

    def add_or_update(self, entry: GlossaryEntry) -> None:
        with self._lock:
            self.entries[entry.source] = entry
            self.save()

    def lock_term(self, source: str) -> bool:
        with self._lock:
            entry = self.entries.get(source)
            if not entry:
                return False
            entry.locked = True
            self.save()
            return True

    def conflict_snapshot(self, limit: int = 100) -> list[TermConflict]:
        with self._lock:
            return list(self.conflicts[-limit:])

    def resolve_conflict(self, source: str, action: str) -> bool:
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
                else:
                    self.entries[source] = GlossaryEntry(
                        source=source,
                        target=conflict.suggested,
                        confidence=0.95,
                        notes="resolved from conflict",
                    )
            elif action in {"lock", "keep_and_lock"}:
                if not entry:
                    self.entries[source] = GlossaryEntry(
                        source=source,
                        target=conflict.previous,
                        confidence=0.95,
                        locked=True,
                        notes="locked from conflict",
                    )
                else:
                    entry.locked = True
            elif action not in {"keep_previous", "keep"}:
                return False
            self.conflicts = [conflict for conflict in self.conflicts if conflict.source != source]
            self.save()
            return True


def _looks_like_noise(term: str) -> bool:
    return len(term) <= 1 or term in {"する", "した", "それ", "これ", "ある", "いる"}


def _guess_term_type(term: str) -> str:
    if term.endswith(("団", "会", "機関", "組")):
        return "organization"
    if term.endswith(("王都", "町", "村", "国", "城")):
        return "place"
    if term.endswith(("剣", "槍", "魔法", "術")):
        return "skill"
    return "proper_noun"


def is_pending_auto_seed(entry: GlossaryEntry | object) -> bool:
    target = getattr(entry, "target", "")
    source = getattr(entry, "source", "")
    notes = getattr(entry, "notes", "")
    return (
        getattr(entry, "locked", False) is False
        and "auto-seeded" in notes
        and (not str(target).strip() or target == source)
    )
