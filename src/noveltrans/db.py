"""SQLite persistence for projects."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

from .utils import now_iso


SCHEMA = """
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS works (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  author TEXT,
  source_url TEXT,
  site TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS episodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_id INTEGER NOT NULL,
  episode_no INTEGER NOT NULL,
  title TEXT NOT NULL,
  source_hash TEXT,
  status TEXT NOT NULL,
  UNIQUE(work_id, episode_no),
  FOREIGN KEY(work_id) REFERENCES works(id)
);
CREATE TABLE IF NOT EXISTS translations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  episode_id INTEGER NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL,
  translated_text TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(episode_id) REFERENCES episodes(id)
);
CREATE TABLE IF NOT EXISTS glossary_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL UNIQUE,
  target TEXT NOT NULL,
  type TEXT,
  confidence REAL,
  locked INTEGER NOT NULL DEFAULT 0,
  reading TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'candidate',
  aliases TEXT NOT NULL DEFAULT '[]',
  variants TEXT NOT NULL DEFAULT '[]',
  forbidden_targets TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '',
  source_score REAL NOT NULL DEFAULT 0,
  target_score REAL NOT NULL DEFAULT 0,
  occurrence_count INTEGER NOT NULL DEFAULT 0,
  episode_count INTEGER NOT NULL DEFAULT 0,
  first_seen_episode INTEGER NOT NULL DEFAULT 0,
  last_seen_episode INTEGER NOT NULL DEFAULT 0,
  origin TEXT NOT NULL DEFAULT 'auto',
  priority INTEGER NOT NULL DEFAULT 0,
  evidence TEXT NOT NULL DEFAULT '[]',
  episode_start INTEGER NOT NULL DEFAULT 0,
  episode_end INTEGER NOT NULL DEFAULT 0,
  speaker TEXT NOT NULL DEFAULT '',
  matching_policy TEXT NOT NULL DEFAULT 'exact'
);
CREATE TABLE IF NOT EXISTS glossary_occurrences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  episode_no INTEGER NOT NULL,
  section_type TEXT,
  start_offset INTEGER,
  end_offset INTEGER,
  context_before TEXT,
  context_after TEXT
);
CREATE TABLE IF NOT EXISTS glossary_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  proposed_target TEXT,
  action TEXT NOT NULL,
  safety TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  episode_id INTEGER NOT NULL,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL,
  retry_count INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(episode_id) REFERENCES episodes(id)
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL
);
"""

GLOSSARY_MIGRATIONS = {
    "reading": "ALTER TABLE glossary_entries ADD COLUMN reading TEXT NOT NULL DEFAULT ''",
    "status": "ALTER TABLE glossary_entries ADD COLUMN status TEXT NOT NULL DEFAULT 'candidate'",
    "aliases": "ALTER TABLE glossary_entries ADD COLUMN aliases TEXT NOT NULL DEFAULT '[]'",
    "variants": "ALTER TABLE glossary_entries ADD COLUMN variants TEXT NOT NULL DEFAULT '[]'",
    "forbidden_targets": "ALTER TABLE glossary_entries ADD COLUMN forbidden_targets TEXT NOT NULL DEFAULT '[]'",
    "notes": "ALTER TABLE glossary_entries ADD COLUMN notes TEXT NOT NULL DEFAULT ''",
    "source_score": "ALTER TABLE glossary_entries ADD COLUMN source_score REAL NOT NULL DEFAULT 0",
    "target_score": "ALTER TABLE glossary_entries ADD COLUMN target_score REAL NOT NULL DEFAULT 0",
    "occurrence_count": "ALTER TABLE glossary_entries ADD COLUMN occurrence_count INTEGER NOT NULL DEFAULT 0",
    "episode_count": "ALTER TABLE glossary_entries ADD COLUMN episode_count INTEGER NOT NULL DEFAULT 0",
    "first_seen_episode": "ALTER TABLE glossary_entries ADD COLUMN first_seen_episode INTEGER NOT NULL DEFAULT 0",
    "last_seen_episode": "ALTER TABLE glossary_entries ADD COLUMN last_seen_episode INTEGER NOT NULL DEFAULT 0",
    "origin": "ALTER TABLE glossary_entries ADD COLUMN origin TEXT NOT NULL DEFAULT 'auto'",
    "priority": "ALTER TABLE glossary_entries ADD COLUMN priority INTEGER NOT NULL DEFAULT 0",
    "evidence": "ALTER TABLE glossary_entries ADD COLUMN evidence TEXT NOT NULL DEFAULT '[]'",
    "episode_start": "ALTER TABLE glossary_entries ADD COLUMN episode_start INTEGER NOT NULL DEFAULT 0",
    "episode_end": "ALTER TABLE glossary_entries ADD COLUMN episode_end INTEGER NOT NULL DEFAULT 0",
    "speaker": "ALTER TABLE glossary_entries ADD COLUMN speaker TEXT NOT NULL DEFAULT ''",
    "matching_policy": "ALTER TABLE glossary_entries ADD COLUMN matching_policy TEXT NOT NULL DEFAULT 'exact'",
}


class ProjectDB:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.init()

    def connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        return conn

    def init(self) -> None:
        with self.connect() as conn:
            conn.executescript(SCHEMA)
            self._migrate_glossary_entries(conn)

    def _migrate_glossary_entries(self, conn: sqlite3.Connection) -> None:
        rows = conn.execute("PRAGMA table_info(glossary_entries)").fetchall()
        columns = {str(row["name"]) for row in rows}
        for column, statement in GLOSSARY_MIGRATIONS.items():
            if column not in columns:
                conn.execute(statement)

    def upsert_work(self, title: str, author: str, source_url: str, site: str) -> int:
        with self.connect() as conn:
            row = conn.execute("SELECT id FROM works WHERE title = ? AND source_url = ?", (title, source_url)).fetchone()
            if row:
                return int(row["id"])
            cursor = conn.execute(
                "INSERT INTO works(title, author, source_url, site, created_at) VALUES (?, ?, ?, ?, ?)",
                (title, author, source_url, site, now_iso()),
            )
            return int(cursor.lastrowid)

    def upsert_episode(self, work_id: int, episode_no: int, title: str, source_hash: str, status: str) -> int:
        with self.connect() as conn:
            row = conn.execute(
                "SELECT id FROM episodes WHERE work_id = ? AND episode_no = ?",
                (work_id, episode_no),
            ).fetchone()
            if row:
                conn.execute(
                    "UPDATE episodes SET title = ?, source_hash = ?, status = ? WHERE id = ?",
                    (title, source_hash, status, row["id"]),
                )
                return int(row["id"])
            cursor = conn.execute(
                "INSERT INTO episodes(work_id, episode_no, title, source_hash, status) VALUES (?, ?, ?, ?, ?)",
                (work_id, episode_no, title, source_hash, status),
            )
            return int(cursor.lastrowid)

    def set_episode_status(self, episode_id: int, status: str) -> None:
        with self.connect() as conn:
            conn.execute("UPDATE episodes SET status = ? WHERE id = ?", (status, episode_id))

    def add_translation(self, episode_id: int, model: str, status: str, translated_text: str) -> None:
        with self.connect() as conn:
            conn.execute(
                "INSERT INTO translations(episode_id, model, status, translated_text, created_at) VALUES (?, ?, ?, ?, ?)",
                (episode_id, model, status, translated_text, now_iso()),
            )
            conn.execute("UPDATE episodes SET status = ? WHERE id = ?", (status, episode_id))

    def upsert_glossary_entry(
        self,
        source: str,
        target: str,
        term_type: str,
        confidence: float,
        locked: bool,
        reading: str = "",
        status: str = "candidate",
        aliases: list[str] | None = None,
        variants: list[str] | None = None,
        forbidden_targets: list[str] | None = None,
        notes: str = "",
        source_score: float = 0.0,
        target_score: float = 0.0,
        occurrence_count: int = 0,
        episode_count: int = 0,
        first_seen_episode: int = 0,
        last_seen_episode: int = 0,
        origin: str = "auto",
        priority: bool = False,
        evidence: list[dict[str, Any]] | None = None,
        episode_start: int = 0,
        episode_end: int = 0,
        speaker: str = "",
        matching_policy: str = "exact",
    ) -> None:
        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO glossary_entries(
                  source, target, type, confidence, locked, reading, status,
                  aliases, variants, forbidden_targets, notes,
                  source_score, target_score, occurrence_count, episode_count,
                  first_seen_episode, last_seen_episode, origin, priority, evidence,
                  episode_start, episode_end, speaker, matching_policy
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(source) DO UPDATE SET
                  target = excluded.target,
                  type = excluded.type,
                  confidence = excluded.confidence,
                  locked = excluded.locked,
                  reading = excluded.reading,
                  status = excluded.status,
                  aliases = excluded.aliases,
                  variants = excluded.variants,
                  forbidden_targets = excluded.forbidden_targets,
                  notes = excluded.notes,
                  source_score = excluded.source_score,
                  target_score = excluded.target_score,
                  occurrence_count = excluded.occurrence_count,
                  episode_count = excluded.episode_count,
                  first_seen_episode = excluded.first_seen_episode,
                  last_seen_episode = excluded.last_seen_episode,
                  origin = excluded.origin,
                  priority = excluded.priority,
                  evidence = excluded.evidence,
                  episode_start = excluded.episode_start,
                  episode_end = excluded.episode_end,
                  speaker = excluded.speaker,
                  matching_policy = excluded.matching_policy
                """,
                (
                    source,
                    target,
                    term_type,
                    confidence,
                    int(locked),
                    reading,
                    status,
                    json.dumps(aliases or [], ensure_ascii=False),
                    json.dumps(variants or [], ensure_ascii=False),
                    json.dumps(forbidden_targets or [], ensure_ascii=False),
                    notes,
                    source_score,
                    target_score,
                    occurrence_count,
                    episode_count,
                    first_seen_episode,
                    last_seen_episode,
                    origin,
                    int(priority),
                    json.dumps(evidence or [], ensure_ascii=False),
                    episode_start,
                    episode_end,
                    speaker,
                    matching_policy,
                ),
            )
            conn.execute("DELETE FROM glossary_occurrences WHERE source = ?", (source,))
            for item in evidence or []:
                conn.execute(
                    """
                    INSERT INTO glossary_occurrences(
                      source, episode_no, section_type, start_offset, end_offset, context_before, context_after
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        source,
                        int(item.get("episode_no", 0) or 0),
                        str(item.get("section_type", "")),
                        int(item.get("start", item.get("start_offset", 0)) or 0),
                        int(item.get("end", item.get("end_offset", 0)) or 0),
                        str(item.get("context_before", "")),
                        str(item.get("context_after", "")),
                    ),
                )

    def add_glossary_decision(
        self,
        source: str,
        proposed_target: str,
        action: str,
        safety: str,
        reason: str = "",
    ) -> None:
        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO glossary_decisions(source, proposed_target, action, safety, reason, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (source, proposed_target, action, safety, reason, now_iso()),
            )

    def create_job(self, episode_id: int, job_type: str) -> int:
        timestamp = now_iso()
        with self.connect() as conn:
            cursor = conn.execute(
                "INSERT INTO jobs(episode_id, job_type, status, retry_count, error, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (episode_id, job_type, "pending", 0, "", timestamp, timestamp),
            )
            return int(cursor.lastrowid)

    def update_job(self, job_id: int, status: str, retry_count: int = 0, error: str = "") -> None:
        with self.connect() as conn:
            conn.execute(
                "UPDATE jobs SET status = ?, retry_count = ?, error = ?, updated_at = ? WHERE id = ?",
                (status, retry_count, error, now_iso(), job_id),
            )

    def audit(self, action: str, detail: str = "") -> None:
        with self.connect() as conn:
            conn.execute(
                "INSERT INTO audit_logs(action, detail, created_at) VALUES (?, ?, ?)",
                (action, detail, now_iso()),
            )

    def counts_by_status(self) -> dict[str, int]:
        with self.connect() as conn:
            rows = conn.execute("SELECT status, COUNT(*) AS count FROM episodes GROUP BY status").fetchall()
        return {str(row["status"]): int(row["count"]) for row in rows}

    def episode_statuses(self) -> dict[int, str]:
        with self.connect() as conn:
            rows = conn.execute("SELECT episode_no, status FROM episodes").fetchall()
        return {int(row["episode_no"]): str(row["status"]) for row in rows}

    def fetch_all(self, query: str, params: tuple[Any, ...] = ()) -> list[sqlite3.Row]:
        with self.connect() as conn:
            return conn.execute(query, params).fetchall()
