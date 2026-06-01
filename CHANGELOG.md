# Changelog

All notable changes to NovelTrans will be documented in this file.

## [Unreleased]

## [2.2.0] - 2026-06-01

### Added

- Added CI smoke workflow coverage before package content checks.
- Added npm provenance publishing and post-publish provenance metadata verification to the release workflow.
- Added plain non-interactive bookshelf output for `noveltrans app`, including no-color rendering for redirected/non-TTY output.
- Added friendly CLI formatting for SQLite locked/busy errors.
- Added automatic repair for missing or partial project episode-state databases from persisted source episodes, with repair events written to the translation log.
- Added SQLite busy timeout and atomic episode-claiming support for queue translation, v2 translation sessions, and single-episode QA retranslation.
- Added stale-running episode recovery so old running claims can be resumed while active concurrent claims are skipped.
- Added QA recheck exclusions so episodes currently being retranslated can keep their existing QA issues while the rest of the project is rechecked.
- Added source-aware glossary context prioritization so relevant confirmed or locked terms, including alias matches, are preferred within glossary prompt limits.
- Added Japanese numeral normalization for QA number checks, including values such as `十二`, `第七`, `万`, and `億`.
- Added repeated-number count detection so QA reports missing duplicate numbers instead of only checking unique values.
- Added strict JSON response validation for OpenAI-compatible and Codex CLI translation responses.
- Added distinct OpenAI-compatible internal timeout errors while preserving user cancellation behavior.
- Added Codex CLI translation isolation with a forced read-only sandbox, temporary working directory, sanitized environment allowlist, and cached availability checks.
- Added v2 command-palette feedback when a search only matches commands that require an open project.
- Added v2 Translate-stage active rows for QA single and batch retranslation jobs.
- Added project episode IDs to v2 studio queue items so active retranslation rows can be deduplicated accurately.
- Added v2 QA stage recheck behavior that excludes currently active QA retranslation episodes.
- Added v2 status-bar hint compaction so high-value actions remain visible in narrow terminals.
- Added local credential-store recovery behavior for corrupted credential files and a canonical config-directory key derivation path with legacy fallback.
- Added log-tail tolerance for malformed project log lines so UI project models can still load.

### Changed

- Restored npm publishing to explicit manual workflow dispatch so git tags and GitHub Releases can be created without publishing the package again.
- Bumped package metadata, package lock, and README release examples to `2.2.0`.
- Updated README documentation to match the current v2 TUI, CLI commands and aliases, import/export behavior, project data layout, credential notes, and npm release workflow.
- Made translation glossary prompts build per segment/chunk so forewords, afterwords, and long body chunks receive glossary context relevant to their own source text.
- Made translation completion metadata keep projects in `translating` while any episode state is still running.
- Made v2 first-run and translation setup checks use the active project backend before falling back to the global default backend.
- Made v2 glossary confirm/forbid actions trim targets before saving.
- Made v2 Translate-stage controls state-aware so completed projects do not show pause/retry controls and non-pausable QA jobs only show cancellation.
- Made v2 stage rail badges more descriptive, for example `42화`, `실패2`, `후보12`, and `검수3`.
- Split long v2 Glossary and QA key-hint rows to avoid cramped layouts.
- Made v2 dismiss timers cancel older timers before scheduling a new one, preventing stale timers from clearing newer messages.

### Fixed

- Prevented concurrent CLI queue runs and v2 translation sessions from translating the same episode more than once.
- Prevented single-episode QA retranslation from taking an episode that another job is already translating.
- Fixed provider timeout errors being treated as user cancellations; timed-out episodes now fail instead of being returned to pending.
- Fixed project overviews when `project.db` is missing or only contains some source episodes.
- Fixed QA rechecks overwriting retained QA issues for episodes intentionally excluded from the recheck.
- Fixed malformed project log lines causing bookshelf/project UI loading failures.
- Fixed blank glossary target saves from optimistically hiding queue items.
- Fixed non-JSON provider responses being accepted as translated body text by real translation adapters.
- Fixed Codex CLI translation exec inheriting unrelated NovelTrans environment variables or honoring a configured `workspace-write` sandbox.
- Fixed status-bar overflow that could hide the Library settings shortcut at 80 columns.
- Fixed palette searches outside a project incorrectly saying there were no matches for project-only commands.
- Fixed QA retranslation jobs not appearing in the Translate-stage active list.
- Fixed QA number checks missing Japanese numerals and repeated-number count changes.
- Fixed corrupted local credential stores blocking later credential saves.
- Fixed possible temporary-file name collisions during atomic JSON and text writes.

### Tests

- Added release workflow regression coverage for provenance publishing.
- Added regression coverage for corrupted credentials, strict adapter responses, Codex isolation, OpenAI-compatible timeouts, concurrent episode claims, state database repair, malformed logs, QA exclusions, Japanese numeral QA, glossary prioritization, v2 status hints, palette messaging, setup backend precedence, glossary target validation, QA recheck exclusions, dismiss timers, and Translate-stage QA retranslation display.

## [2.1.5] - 2026-06-01

### Added

- Added v2 QA filters by issue bucket and grouped QA triage by episode, with per-episode issue counts and comparison details.
- Added v2 QA retranslation jobs for the selected issue, same issue type, or all filtered open issues, including progress, cancellation, and current-episode feedback.
- Added a glossary queue filter for confirmed and locked terms.
- Added Korean two-set keyboard fallback for committed single-key v2 TUI shortcuts.

### Changed

- Switched v2 job tracking from a single global job to project-scoped jobs, allowing different projects to run translation jobs independently while keeping web import progress separate.
- Moved v2 job progress out of the global status bar and into the active project workspace, with clearer job kind labels for translation, retry, export, and QA retranslation.
- Made v2 QA actions respect the active QA filter when ignoring issues, opening translations, or retranslating batches.
- Made glossary review queue keyboard actions remove the selected term and show completion feedback immediately while the project save refreshes in the background.
- Changed QA recheck logging and feedback to report open issue counts separately from total detected issues.

### Fixed

- Preserved resolved QA issue state across QA reruns by giving detected issues stable fingerprints.
- Hid QA issues for episodes that are currently being retranslated from the v2 QA queue, stage badge counts, and keyboard-action targets.
- Restored optimistically hidden glossary queue terms if a background review action save fails.
- Kept quit confirmation active for project jobs and web imports that are running or paused.

### Removed

- Removed the v2 Source-stage re-import shortcut and related help text.

## [2.1.4] - 2026-05-31

### Added

- Added npm Trusted Publishing release automation through GitHub Actions OIDC.
- Added npm package repository, issue tracker, homepage, and registry publish metadata.
- Documented npm Trusted Publishing setup and release tag requirements.

### Changed

- Switched release publishing from long-lived `NPM_TOKEN` authentication to trusted publishing.
- Updated CI and release workflows to run on Node.js `22.x` with current GitHub Actions.

## [2.1.3] - 2026-05-31

### Added

- Added a v2 first-run setup wizard for selecting the translation engine, model, credentials, and validation checks.
- Added v2 translation cancellation and a quit confirmation when translation is running or paused.
- Added CLI dry-run warnings so placeholder translation output is explicit before a job starts.
- Added grouped Korean CLI help with command descriptions, aliases, examples, and global options.

### Changed

- Localized CLI errors and translator availability messages into Korean.
- Kept library `Esc` navigation from quitting the app; `q` and `Ctrl+C` remain quit shortcuts.
- Made critical v2 failures open persistent notice overlays instead of transient status messages.

### Fixed

- Prevented OpenAI-compatible v2 translation from starting without an API key by opening credential setup.
- Refreshed library loading state after completed or failed background jobs.
- Preserved npm package executable metadata with the `dist/index.js` bin target.

## [2.1.2] - 2026-05-30

### Added

- Added a v2 web-import consent step with import duration guidance and live progress tracking.
- Added v2 settings inputs for storing the OpenAI-compatible API key and updating the API base URL.
- Added animated job feedback for export, web import, and translation status updates.

### Changed

- Made v2 status messages carry severity so success, warning, and critical feedback render distinctly.
- Reworked severity badges to use shape-distinct glyphs that remain readable without color, with a smaller critical glyph.
- Localized v2 breadcrumb and relative-time chrome into Korean.

### Fixed

- Warned before dry-run translation starts so users do not accidentally generate placeholder output.
- Replaced silent duplicate translation starts with visible warning feedback.
- Added an overflow indicator when v2 content exceeds the terminal viewport.

## [2.1.1] - 2026-05-30

### Changed

- Switched release expectations from GitHub installs with committed `dist/` to npm package publishing with generated build artifacts.
- Updated credential wording to describe the local store as filesystem-permission protected rather than strong encryption.
- Removed generated `dist/` files from the repository and kept them as package-time build output.
- Removed stale v2 planning documents and unused legacy UI helpers left after the v2 TUI migration.
- Reduced internal-only TypeScript exports across the CLI, engine, storage, translation, TUI, and web-import modules.

### Fixed

- Fixed numeric episode artifact ordering for serials with 1000+ episodes while preserving reads of old 3-digit project files.
- Rejected cleartext OpenAI-compatible base URLs before bearer tokens are sent.
- Hardened web import fetches with per-request allowlist validation and redirect rejection.
- Made CLI value options fail fast when a value is missing.
- Extended QA coverage to translated foreword and afterword sections.
- Made the export preview glossary appendix count match the actual confirmed/locked appendix filter.

## [2.1.0] - 2026-05-30

### Added

- Added the new dependency-free `src/ui-v2/` terminal frontend, including a raw-mode/alternate-screen runtime, diff renderer, semantic input decoder, theme/capability detection, and pure reusable components for boxes, rails, lists, badges, progress bars, breadcrumbs, status bars, modals, and overlays.
- Added the new Library and Project Workspace flow. The Project Workspace replaces the old room-based app with Overview, Source, Translate, Glossary, QA, and Export stages on a responsive stage rail.
- Added global job state in the v2 app so translation/retry progress remains visible while moving between stages.
- Added v2 Source, Translate, Glossary, QA, and Export stage views with source previews, inline failed-episode recovery, glossary queue triage, QA issue comparison, output option toggles, and export generation.
- Added v2 Help, Settings, Command Palette, confirmation modal, input modal, toast dismissal, search, and keyboard navigation flows.
- Added URL import support in the v2 input flow where users paste only the URL, then enter the episode range as a separate option.
- Added reusable UI action helpers for v2 import and translation jobs.
- Added static v2 renderers so non-interactive commands can reuse the same Library, Project stage, and Command Palette views as the interactive app.
- Added Review Desk batch retranslation helpers for all open issues or issues of the same type.
- Added tests for the v2 runtime, input decoding, renderer behavior, theme capability fallback, Library, Project shell, Source stage, Glossary/QA triage, Phase 4 overlays/actions, v2 workflow imports, and Codex model/credential handling.

### Changed

- Made the v2 frontend the default for `noveltrans app` and for launching `noveltrans` with no arguments in a TTY.
- Rewired `bookshelf`, `studio`, `glossary-lab`, `review-desk`, `failure-recovery`, `export-room`, and `palette` command output to the new v2 static views.
- Simplified web imports. CLI URL import now uses `--url ... --episodes ...` without `--confirm-rights`; TUI URL import asks only for the episode range. Rights confirmation is set internally for imported projects.
- Changed the import action so v2 TXT, inline text, and web imports do not pin the global default model into project metadata.
- Changed settings model cycling so the active backend model is updated. Codex CLI model changes now update the Codex model path instead of cycling only the OpenAI-compatible model.
- Changed Codex project adapter creation to clear legacy OpenAI default model pins from Codex-backed project metadata before creating the runtime adapter.
- Expanded the command palette with afterword output, model, and concurrency commands.
- Updated README command examples and UI documentation for v2 and `2.1.0`.
- Updated `package.json` and `package-lock.json` to version `2.1.0`.

### Fixed

- Fixed Codex CLI projects created with a stale generic default model so v2 jobs fall back to the configured Codex runtime model.
- Fixed URL import ergonomics in the TUI by treating episode range as a UI option instead of requiring command-style text after the URL.
- Fixed bracketed paste handling for URL import input through the v2 semantic input path.

### Removed

- Removed the legacy interactive terminal UI implementation, including the monolithic `terminalApp`, old screens, key handlers, renderer, line reader, layout helpers, import drop-in flow, and old task/status widgets.
- Removed legacy UI action/screen tests that targeted the deleted terminal UI.
- Removed the old `docs/UI_UX_PLANS.md` plan in favor of `docs/UI_V2_PLAN.md`.

## [2.0.4] - 2026-05-29

### Fixed

- Made web import HTML body extraction preserve nested same-tag content.
- Prevented unfinished or empty exports from marking projects as `exported`.
- Kept long-episode chunk metadata out of translated episode titles.
- Reduced glossary QA false positives by checking target variants only when the source term appears in the episode.
- Hardened config loading against malformed nested JSON values.
- Made TXT and EPUB glossary appendices consistently include only confirmed or locked terms.

## [2.0.3] - 2026-05-29

### Changed

- Removed the install-time `prepare` build for GitHub npm installs.
- Committed runtime `dist/` output so `npm install -g github:minseung07/NovelTrans` does not depend on TypeScript or Node type resolution in the installer's temporary clone.

## [2.0.2] - 2026-05-29

### Fixed

- Fixed GitHub npm installation in environments where TypeScript does not auto-discover Node.js type definitions by explicitly enabling Node types in `tsconfig.json`.

## [2.0.1] - 2026-05-29

### Fixed

- Fixed GitHub npm installation by making the install-time TypeScript build use available package dependencies.
- Split runtime build and test build configs so `prepare` does not compile test sources during GitHub installs.

## [2.0.0] - 2026-05-29

Initial public release.

### Added

- TypeScript CLI entry point with `noveltrans` binary.
- Terminal app workflow for bookshelf, studio, import, glossary, review, recovery, settings, and export screens.
- Project-based TXT, stdin, inline text, Kakuyomu URL, and Syosetu URL import.
- Episode splitting for common Japanese web novel headings.
- Resumable translation queue with configurable concurrency.
- Failed-episode retry workflow.
- Glossary candidate extraction, confirmation, locking, conflict detection, deprecation, and forbidden target handling.
- QA checks for remaining Japanese text, number mismatches, length ratio, and glossary consistency.
- TXT and EPUB export.
- `dry-run`, `openai-compatible`, and `codex-cli` translation backends.
- Local config and filesystem-permission protected credential storage.
- GitHub npm install support through `prepare`, with `dist/` generated at install time.
- Package file allowlist for distributable runtime files, README, changelog, and license.

### Fixed

- Preserved glossary candidates from parallel translation workers.
- Applied Import Drop-in recipe changes to the created project.
- Cleared stale QA issue files when QA is rerun for episodes without translations.
- Accepted Syosetu work URLs both with and without a trailing slash.

### Notes

- `dist/` remains ignored in the repository. GitHub installs build it during `npm install`.
- Node.js `>=22.5.0` is required.
