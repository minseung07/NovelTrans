"""SQLite persistence for projects."""

from __future__ import annotations

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
  locked INTEGER NOT NULL DEFAULT 0
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
        self, source: str, target: str, term_type: str, confidence: float, locked: bool
    ) -> None:
        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO glossary_entries(source, target, type, confidence, locked)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(source) DO UPDATE SET
                  target = excluded.target,
                  type = excluded.type,
                  confidence = excluded.confidence,
                  locked = excluded.locked
                """,
                (source, target, term_type, confidence, int(locked)),
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
