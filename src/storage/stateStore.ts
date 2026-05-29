import { createRequire } from "node:module";
import type { Episode } from "../domain/episode.js";
import type { EpisodeState, EpisodeStatus, JobStatus, RunRecord } from "../domain/project.js";
import { withSuppressedExperimentalSqliteWarning } from "../runtime/warnings.js";
import { nowIso } from "../utils/time.js";

type SqliteRow = Record<string, unknown>;

type StatementLike = {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): SqliteRow | undefined;
  all(...params: unknown[]): SqliteRow[];
};

type DatabaseLike = {
  exec(sql: string): void;
  prepare(sql: string): StatementLike;
  close(): void;
};

const require = createRequire(import.meta.url);
let DatabaseSyncConstructor: (new (path: string) => DatabaseLike) | null = null;

export class ProjectStateStore {
  private readonly db: DatabaseLike;

  constructor(dbPath: string) {
    this.db = new (loadDatabaseSync())(dbPath);
    this.initialize();
  }

  close(): void {
    this.db.close();
  }

  initializeEpisodeStates(episodes: Episode[]): void {
    const statement = this.db.prepare(
      "INSERT OR IGNORE INTO episode_states (episode_id, episode_no, title, status, attempts, error_message, updated_at) VALUES (?, ?, ?, 'pending', 0, NULL, ?)"
    );
    const updatedAt = nowIso();
    for (const episode of episodes) {
      statement.run(episode.id, episode.episodeNo, episode.title, updatedAt);
    }
  }

  listEpisodeStates(): EpisodeState[] {
    const rows = this.db
      .prepare("SELECT episode_id, episode_no, title, status, attempts, error_message, updated_at FROM episode_states ORDER BY episode_no")
      .all();
    return rows.map(rowToEpisodeState);
  }

  getEpisodeState(episodeId: string): EpisodeState | null {
    const row = this.db
      .prepare("SELECT episode_id, episode_no, title, status, attempts, error_message, updated_at FROM episode_states WHERE episode_id = ?")
      .get(episodeId);
    return row ? rowToEpisodeState(row) : null;
  }

  markEpisodeRunning(episodeId: string): void {
    this.db
      .prepare("UPDATE episode_states SET status = 'running', attempts = attempts + 1, error_message = NULL, updated_at = ? WHERE episode_id = ?")
      .run(nowIso(), episodeId);
  }

  setEpisodeStatus(episodeId: string, status: EpisodeStatus, errorMessage: string | null = null): void {
    this.db
      .prepare("UPDATE episode_states SET status = ?, error_message = ?, updated_at = ? WHERE episode_id = ?")
      .run(status, errorMessage, nowIso(), episodeId);
  }

  createRun(record: RunRecord): void {
    this.db
      .prepare(
        "INSERT INTO runs (id, project_id, type, started_at, ended_at, status, backend, model, episode_count, error_message) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        record.id,
        record.projectId,
        record.type,
        record.startedAt,
        record.endedAt ?? null,
        record.status,
        record.backend ?? null,
        record.model ?? null,
        record.episodeCount ?? null,
        record.errorMessage ?? null
      );
  }

  listRuns(): RunRecord[] {
    const rows = this.db
      .prepare("SELECT id, project_id, type, started_at, ended_at, status, backend, model, episode_count, error_message FROM runs ORDER BY started_at")
      .all();
    return rows.map(rowToRunRecord);
  }

  finishRun(runId: string, status: JobStatus, errorMessage?: string): void {
    this.db
      .prepare("UPDATE runs SET status = ?, ended_at = ?, error_message = ? WHERE id = ?")
      .run(status, nowIso(), errorMessage ?? null, runId);
  }

  private initialize(): void {
    this.db.exec(`
      PRAGMA journal_mode = WAL;

      CREATE TABLE IF NOT EXISTS episode_states (
        episode_id TEXT PRIMARY KEY,
        episode_no INTEGER NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        error_message TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        type TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        status TEXT NOT NULL,
        backend TEXT,
        model TEXT,
        episode_count INTEGER,
        error_message TEXT
      );
    `);
  }
}

function loadDatabaseSync(): new (path: string) => DatabaseLike {
  if (!DatabaseSyncConstructor) {
    const sqlite = withSuppressedExperimentalSqliteWarning(() =>
      require("node:sqlite") as {
        DatabaseSync: new (path: string) => DatabaseLike;
      }
    );
    DatabaseSyncConstructor = sqlite.DatabaseSync;
  }
  return DatabaseSyncConstructor;
}

function rowToEpisodeState(row: SqliteRow): EpisodeState {
  return {
    episodeId: String(row.episode_id),
    episodeNo: Number(row.episode_no),
    title: String(row.title),
    status: String(row.status) as EpisodeStatus,
    attempts: Number(row.attempts),
    errorMessage: row.error_message === null || row.error_message === undefined ? null : String(row.error_message),
    updatedAt: String(row.updated_at)
  };
}

function rowToRunRecord(row: SqliteRow): RunRecord {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    type: String(row.type) as RunRecord["type"],
    startedAt: String(row.started_at),
    endedAt: row.ended_at === null || row.ended_at === undefined ? undefined : String(row.ended_at),
    status: String(row.status) as RunRecord["status"],
    backend: row.backend === null || row.backend === undefined ? undefined : String(row.backend),
    model: row.model === null || row.model === undefined ? undefined : String(row.model),
    episodeCount: row.episode_count === null || row.episode_count === undefined ? undefined : Number(row.episode_count),
    errorMessage: row.error_message === null || row.error_message === undefined ? undefined : String(row.error_message)
  };
}
