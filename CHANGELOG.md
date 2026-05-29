# Changelog

All notable changes to NovelTrans will be documented in this file.

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
- Local config and encrypted credential storage.
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
