"""Episode-level translation orchestration."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict
from threading import Lock

from .glossary import GlossaryManager
from .errors import TranslationError
from .models import EpisodeText, ParallelOptions, QAIssue, QualityOptions, Section, TranslationOptions, TranslationResult
from .project import Project
from .qa import QAEngine
from .translator import Translator
from .utils import atomic_write_json, atomic_write_text, markdown_heading, now_iso, read_json


class TranslationOrchestrator:
    def __init__(
        self,
        project: Project,
        translator: Translator,
        translation_options: TranslationOptions,
        parallel_options: ParallelOptions,
        quality_options: QualityOptions,
    ) -> None:
        self.project = project
        self.translator = translator
        self.translation_options = translation_options
        self.parallel_options = parallel_options
        self.quality_options = quality_options
        self.glossary = GlossaryManager(project.glossary_dir)
        self.qa = QAEngine()
        self._summary_lock = Lock()
        self._db_lock = Lock()
        self._log_lock = Lock()
        self._previous_summary = ""

    async def run(self, episode_numbers: list[int] | None = None, resume: bool = True) -> list[int]:
        """Async-compatible wrapper for callers that already expose an async API."""

        return self.run_sync(episode_numbers=episode_numbers, resume=resume)

    def run_sync(self, episode_numbers: list[int] | None = None, resume: bool = True) -> list[int]:
        episodes = self.project.list_source_episodes()
        if episode_numbers:
            wanted = set(episode_numbers)
            episodes = [episode for episode in episodes if episode.episode_no in wanted]
        if resume:
            statuses = self.project.db.episode_statuses()
            episodes = [
                episode
                for episode in episodes
                if not (
                    statuses.get(episode.episode_no) == "completed"
                    and self.project.translation_path(episode.episode_no).exists()
                )
            ]
        self.glossary.seed_from_episodes(episodes)
        self._sync_glossary_to_db()
        work_id = self._ensure_work_registered()
        for episode in episodes:
            with self._db_lock:
                self.project.db.upsert_episode(work_id, episode.episode_no, episode.title, episode.source_hash, "pending")

        completed: list[int] = []
        max_workers = max(1, self.parallel_options.max_parallel_episodes)
        with ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="noveltrans") as executor:
            futures = {executor.submit(self._translate_with_retry, episode, work_id): episode for episode in episodes}
            for future in as_completed(futures):
                episode = futures[future]
                if future.result():
                    completed.append(episode.episode_no)
        self._write_quality_report()
        return sorted(completed)

    def _translate_with_retry(self, episode: EpisodeText, work_id: int) -> bool:
        with self._db_lock:
            episode_id = self.project.db.upsert_episode(
                work_id, episode.episode_no, episode.title, episode.source_hash, "running"
            )
            job_id = self.project.db.create_job(episode_id, "translation")
        for attempt in range(self.parallel_options.retries + 1):
            try:
                with self._db_lock:
                    self.project.db.update_job(job_id, "running", retry_count=attempt)
                result = self._translate_episode(episode)
                conflicts = self.glossary.update_from_terms(result.new_terms)
                result.term_conflicts.extend(conflicts)
                self._sync_glossary_to_db()
                issues = self._run_qa(episode, result)
                self._save_translation(episode, result, issues)
                with self._db_lock:
                    self.project.db.add_translation(
                        episode_id,
                        self.translation_options.model,
                        "completed",
                        self.project.translation_path(episode.episode_no).read_text(encoding="utf-8"),
                    )
                    self.project.db.update_job(job_id, "completed", retry_count=attempt)
                self._set_previous_summary(result.episode_summary)
                return True
            except Exception as exc:  # noqa: BLE001 - job failure must be persisted.
                error = str(exc)
                if attempt >= self.parallel_options.retries:
                    with self._db_lock:
                        self.project.db.update_job(job_id, "failed", retry_count=attempt, error=error)
                        self.project.db.set_episode_status(episode_id, "failed")
                    self._append_log("translation.log", f"{now_iso()} episode {episode.episode_no} failed: {error}\n")
                    return False
                self._append_log(
                    "translation.log",
                    f"{now_iso()} episode {episode.episode_no} retry {attempt + 1}: {error}\n",
                )
        return False

    def _translate_episode(self, episode: EpisodeText) -> TranslationResult:
        if not self._should_split_episode(episode):
            result = self.translator.translate_episode(
                episode,
                self.translation_options,
                self.glossary.snapshot(),
                self._episode_context_summary(),
            )
            return self._normalize_translation_result(result)

        parts: list[TranslationResult] = []
        rolling_summary = self._episode_context_summary()
        chunks = _split_episode_for_translation(episode, self.parallel_options.long_episode_threshold_chars)
        for chunk in chunks:
            result = self.translator.translate_episode(
                chunk,
                self.translation_options,
                self.glossary.snapshot(),
                rolling_summary,
            )
            result = self._normalize_translation_result(result)
            parts.append(result)
            if result.episode_summary:
                rolling_summary = result.episode_summary
        merged = _merge_translation_results(episode, parts)
        merged.qa_notes.append(f"long episode split into {len(chunks)} chunk(s)")
        return merged

    def _should_split_episode(self, episode: EpisodeText) -> bool:
        return (
            self.parallel_options.split_long_episode
            and len(episode.all_text()) > self.parallel_options.long_episode_threshold_chars
        )

    def _normalize_translation_result(self, result: TranslationResult) -> TranslationResult:
        if not self.translation_options.translate_author_notes:
            result.afterword_ko = ""
        self._assert_translation_has_content(result)
        return result

    def _assert_translation_has_content(self, result: TranslationResult) -> None:
        if any(part.strip() for part in (result.foreword_ko, result.body_ko, result.afterword_ko)):
            return
        raise TranslationError("번역 결과 본문이 비어 있습니다.")

    def _ensure_work_registered(self) -> int:
        manifest = self.project.load_manifest()
        with self._db_lock:
            return self.project.db.upsert_work(
                manifest.work.title,
                manifest.work.author,
                manifest.work.source_url,
                manifest.work.site,
            )

    def _get_previous_summary(self) -> str:
        with self._summary_lock:
            return self._previous_summary

    def _episode_context_summary(self) -> str:
        if self.parallel_options.max_parallel_episodes > 1:
            return ""
        return self._get_previous_summary()

    def _set_previous_summary(self, summary: str) -> None:
        if not summary:
            return
        with self._summary_lock:
            self._previous_summary = summary

    def _sync_glossary_to_db(self) -> None:
        with self._db_lock:
            for entry in self.glossary.snapshot(limit=10_000):
                self.project.db.upsert_glossary_entry(
                    entry.source,
                    entry.target,
                    entry.type,
                    entry.confidence,
                    entry.locked,
                )

    def _run_qa(self, episode: EpisodeText, result: TranslationResult) -> list[QAIssue]:
        if not self.quality_options.run_qa_pass:
            return []
        return self.qa.run(
            episode,
            result,
            self.glossary.snapshot(),
            banned_terms=self.quality_options.banned_terms,
            check_missing_paragraphs=self.quality_options.check_missing_paragraphs,
            compare_length_ratio=self.quality_options.compare_length_ratio,
            check_term_consistency=self.quality_options.run_term_consistency_pass,
        )

    def _save_translation(self, episode: EpisodeText, result: TranslationResult, issues: list[QAIssue]) -> None:
        path = self.project.translation_path(episode.episode_no)
        parts = [markdown_heading(1, result.title_ko or episode.title)]
        if result.foreword_ko.strip():
            parts.append(markdown_heading(2, "전서") + result.foreword_ko.strip() + "\n\n")
        if result.body_ko.strip():
            if result.foreword_ko.strip() or result.afterword_ko.strip():
                parts.append(markdown_heading(2, "본문"))
            parts.append(result.body_ko.strip() + "\n\n")
        if result.afterword_ko.strip():
            parts.append(markdown_heading(2, "후기") + result.afterword_ko.strip() + "\n\n")
        if result.qa_notes:
            parts.append(markdown_heading(2, "번역 메모") + "\n".join(f"- {note}" for note in result.qa_notes) + "\n")
        atomic_write_text(path, "".join(parts).rstrip() + "\n")
        atomic_write_json(
            self.project.qa_path(episode.episode_no),
            {
                "episode_no": episode.episode_no,
                "issues": [asdict(issue) for issue in issues],
                "term_conflicts": [asdict(conflict) for conflict in result.term_conflicts],
                "summary": result.episode_summary,
            },
        )
        self._append_log(
            "qa.log",
            f"{now_iso()} episode {episode.episode_no}: {len(issues)} QA issue(s), "
            f"{len(result.term_conflicts)} term conflict(s)\n",
        )

    def _append_log(self, name: str, text: str) -> None:
        path = self.project.logs_dir / name
        path.parent.mkdir(parents=True, exist_ok=True)
        with self._log_lock:
            with path.open("a", encoding="utf-8") as fh:
                fh.write(text)

    def _write_quality_report(self) -> None:
        reports = []
        total_issues = 0
        total_conflicts = 0
        for path in sorted(self.project.logs_dir.glob("episode_*.qa.json")):
            payload = read_json(path, default={}) or {}
            issues = payload.get("issues", [])
            conflicts = payload.get("term_conflicts", [])
            total_issues += len(issues)
            total_conflicts += len(conflicts)
            reports.append(payload)
        atomic_write_json(
            self.project.logs_dir / "quality_report.json",
            {
                "generated_at": now_iso(),
                "episode_reports": reports,
                "total_issues": total_issues,
                "total_term_conflicts": total_conflicts,
                "global_term_issues": self._global_term_issues(),
                "status_counts": self.project.db.counts_by_status(),
            },
        )
        self._write_quality_report_text(reports, total_issues, total_conflicts)

    def _write_quality_report_text(
        self,
        reports: list[dict[str, object]],
        total_issues: int,
        total_conflicts: int,
    ) -> None:
        status_counts = self.project.db.counts_by_status()
        global_term_issues = self._global_term_issues()
        lines = [
            "NovelTrans Quality Report",
            f"generated_at: {now_iso()}",
            f"status_counts: {status_counts}",
            f"total_issues: {total_issues}",
            f"total_term_conflicts: {total_conflicts}",
            f"global_term_issues: {len(global_term_issues)}",
            "",
        ]
        for report in reports:
            episode_no = report.get("episode_no", "?")
            issues = report.get("issues", [])
            conflicts = report.get("term_conflicts", [])
            lines.append(f"Episode {episode_no}")
            if not issues and not conflicts:
                lines.append("- no QA issues or term conflicts")
            for issue in issues if isinstance(issues, list) else []:
                if isinstance(issue, dict):
                    lines.append(
                        f"- [{issue.get('severity', 'info')}] {issue.get('code', 'unknown')}: "
                        f"{issue.get('message', '')}"
                    )
            for conflict in conflicts if isinstance(conflicts, list) else []:
                if isinstance(conflict, dict):
                    lines.append(
                        f"- [term_conflict] {conflict.get('source', '')}: "
                        f"{conflict.get('previous', '')} -> {conflict.get('suggested', '')}"
                    )
            lines.append("")
        if global_term_issues:
            lines.append("Global Term Issues")
            for issue in global_term_issues:
                lines.append(
                    f"- episode {issue.get('episode_no', '?')}: "
                    f"{issue.get('source', '')} -> {issue.get('target', '')}"
                )
        atomic_write_text(self.project.logs_dir / "quality_report.txt", "\n".join(lines).rstrip() + "\n")

    def _global_term_issues(self) -> list[dict[str, object]]:
        if not self.quality_options.run_term_consistency_pass:
            return []
        issues: list[dict[str, object]] = []
        glossary = [
            entry
            for entry in self.glossary.snapshot(limit=10_000)
            if entry.source and entry.target and not _is_pending_auto_seed(entry)
        ]
        for source_episode in self.project.list_source_episodes():
            translated_path = self.project.translation_path(source_episode.episode_no)
            if not translated_path.exists():
                continue
            translated = translated_path.read_text(encoding="utf-8")
            source_text = source_episode.all_text()
            for entry in glossary:
                if entry.source in source_text and entry.target not in translated:
                    issues.append(
                        {
                            "episode_no": source_episode.episode_no,
                            "source": entry.source,
                            "target": entry.target,
                            "message": f"용어집 번역 누락 후보: {entry.source} -> {entry.target}",
                        }
                    )
        return issues


def _split_episode_for_translation(episode: EpisodeText, threshold_chars: int) -> list[EpisodeText]:
    threshold = max(1000, threshold_chars)
    chunks: list[list[Section]] = []
    current: list[Section] = []
    current_len = 0
    for section in episode.sections:
        paragraphs = _split_section_paragraphs(section.text)
        for paragraph in paragraphs:
            paragraph_len = len(paragraph)
            if current and current_len + paragraph_len > threshold:
                chunks.append(current)
                current = []
                current_len = 0
            current.append(Section(type=section.type, text=paragraph))
            current_len += paragraph_len
    if current:
        chunks.append(current)
    if not chunks:
        return [episode]
    return [
        EpisodeText(
            episode_no=episode.episode_no,
            title=f"{episode.title} (part {index}/{len(chunks)})",
            sections=_merge_sections(sections),
            source_url=episode.source_url,
            source_hash=episode.source_hash,
            metadata={**episode.metadata, "chunk_index": index, "chunk_count": len(chunks)},
        )
        for index, sections in enumerate(chunks, start=1)
    ]


def _split_section_paragraphs(text: str) -> list[str]:
    paragraphs = [paragraph.strip() for paragraph in text.split("\n\n") if paragraph.strip()]
    return paragraphs or ([text.strip()] if text.strip() else [])


def _merge_sections(sections: list[Section]) -> list[Section]:
    merged: list[Section] = []
    for section in sections:
        if merged and merged[-1].type == section.type:
            merged[-1] = Section(type=section.type, text=merged[-1].text.rstrip() + "\n\n" + section.text.strip())
        else:
            merged.append(section)
    return merged


def _merge_translation_results(episode: EpisodeText, parts: list[TranslationResult]) -> TranslationResult:
    if not parts:
        return TranslationResult(title_ko=episode.title, body_ko="")
    return TranslationResult(
        title_ko=next((part.title_ko for part in parts if part.title_ko), episode.title),
        foreword_ko="\n\n".join(part.foreword_ko.strip() for part in parts if part.foreword_ko.strip()),
        body_ko="\n\n".join(part.body_ko.strip() for part in parts if part.body_ko.strip()),
        afterword_ko="\n\n".join(part.afterword_ko.strip() for part in parts if part.afterword_ko.strip()),
        new_terms=[term for part in parts for term in part.new_terms],
        term_conflicts=[conflict for part in parts for conflict in part.term_conflicts],
        episode_summary="\n".join(part.episode_summary for part in parts if part.episode_summary),
        qa_notes=[note for part in parts for note in part.qa_notes],
        raw_response={"chunks": [part.raw_response for part in parts]},
    )


def _is_pending_auto_seed(entry: object) -> bool:
    return (
        getattr(entry, "locked", False) is False
        and getattr(entry, "target", "") == getattr(entry, "source", None)
        and "auto-seeded" in getattr(entry, "notes", "")
    )
