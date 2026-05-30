# Changelog

All notable changes to NovelTrans will be documented in this file.

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
