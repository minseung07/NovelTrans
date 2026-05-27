# Changelog

All notable changes to NovelTrans CLI will be documented in this file.

## [1.0.5] - 2026-05-27

### Added

- Top-level `noveltrans --help` now lists supported subcommands, and command-specific help is available through argparse subcommands.
- Settings now exposes start-flow, translation, QA, export, and auth/storage groups so advanced choices can be configured before launching translation work.
- URL policy guidance now lists available actions for automatic collection, metadata-only URLs, user-provided source input, and blocked login/paywall/captcha paths.

### Changed

- New project creation now keeps the start path minimal by using Settings defaults for source mode, episode range, URL collection behavior, translation options, QA, and export formats.
- Non-interactive command handlers and shared project status formatting were split out of the entry point.

### Removed

- Removed the legacy `--classic` prompt flow so all interactive usage goes through the maintained wizard.

## [1.0.4] - 2026-05-27

### Changed

- Interactive CLI option screens now use guided selections for episode ranges, model choice, output formats, custom translation style, honorific policy, glossary strictness, temperature, long-episode splitting, and glossary term types.
- Free-form prompts now show examples or context when a typed value is still required.
- Translation run screens now show live pending, running, completed, and failed episode ranges while jobs are active.
- Obviously malformed OpenAI credentials are ignored/rejected before translation so bad local tokens fail early instead of producing repeated API 401 jobs.
- Auto-seeded glossary candidates now keep the Korean target pending instead of writing Japanese-to-Japanese mappings into exports.
- New project creation now uses settings defaults by default, moves advanced translation/output choices behind one optional screen, and supports back navigation in wizard prompts.
- Removed the unused Textual UI path so the maintained interactive interface is the terminal wizard.

## [1.0.3] - 2026-05-27

### Added

- Kakuyomu public-page connector for authorized personal-use workflows, including work metadata, episode listing, and public episode body extraction.

### Changed

- URL workflows now prefer an explicit user-provided fallback file over automatic fetch when both are available.
- README site-policy notes now distinguish Kakuyomu public-page support from Syosetu metadata-only support.

## [1.0.1] - 2026-05-27

### Changed

- Codex CLI translation now sends prompts through stdin via `codex exec -` instead of passing full episode prompts as command-line arguments.
- New projects write `project.json` manifests while retaining read compatibility with legacy `project.yaml` manifests.
- Release checklist documentation now includes `noveltrans doctor --strict`.

## [1.0.0] - 2026-05-27

### Added

- Initial NovelTrans CLI release for authorized Japanese web novel translation workflows.
- Keyboard-driven terminal wizard launched with `noveltrans`.
- Local TXT, HTML, ZIP, clipboard, manual paste, and editor-based source input flows.
- Site policy gate with built-in connector policies for Aozora Bunko, Syosetu metadata, Kakuyomu, Hameln, pixiv novels, and local files.
- Restricted-site URL workflows that preserve source metadata while requiring user-provided body text.
- Project layout with JSON manifest, SQLite state database, source episodes, translated Markdown, glossary files, exports, and logs.
- Episode-level translation orchestration with resume support, retries, QA logs, and optional long-episode splitting.
- Translation backends for OpenAI Responses API, Codex CLI, and offline dry-run validation.
- Glossary seeding, update, conflict tracking, locking, and SQLite synchronization.
- QA checks for missing paragraphs, length ratio, Japanese leftovers, numbers, glossary consistency, name variants, speech-style mixing, and banned terms.
- TXT, DOCX, and EPUB exporters implemented with the Python standard library.
- Verification, status, estimate, report, policy import/refresh/show, and credential management CLI commands.
- Connector plugin entry point support under `noveltrans.connectors`.
- CI workflow and test suite covering connectors, policies, preprocessing, workflow resume, exporters, credentials, and translator parsing.

### Security

- Requires rights and non-redistribution confirmations for non-interactive source workflows.
- Blocks automated body fetch for restricted sites and avoids cookie import, CAPTCHA bypass, paywall bypass, and login-session scraping.
- Stores OpenAI API keys or bearer tokens through keyring when available, with a local restricted-permission encrypted fallback.
