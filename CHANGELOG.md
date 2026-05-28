# Changelog

All notable changes to NovelTrans CLI will be documented in this file.

## [1.0.11] - 2026-05-28

### Changed

- Recent projects are now sorted by manifest `updated_at` with newest work first.
- New translation projects now ask for the project title before source input instead of defaulting to `my_novel`.

## [1.0.10] - 2026-05-28

### Added

- Added workflow progress events for source preparation, project creation, translation setup, export, and completion.
- Added a preparation status screen for new project creation and source import so long file parsing or URL setup is visible immediately after confirmation.

### Changed

- Replaced the translation progress screen's repeated full-screen redraw with a fixed-block renderer that refreshes on state changes or a slower cadence.
- New translation runs now show the same token/cost estimate confirmation used by resume runs after the source project has been prepared.
- Split advanced settings into translation, glossary, QA/review, and storage/cost groups.
- Project selection now supports filtering when many projects are present.
- Glossary management now shows summary counts for confirmed, review, locked, and conflicting terms.
- Top-level CLI help now states that running `noveltrans` without a subcommand launches the wizard.

### Fixed

- Fixed wizard dry-run fallback so selecting a dry-run path cannot be overridden by the original backend argument.

## [1.0.9] - 2026-05-28

### Added

- Added glossary v2 candidate/proposal/decision flow so model-suggested terms are validated before any project glossary update is applied.
- Added safe glossary update policy controls through `--glossary-updates`, project translation options, and the terminal wizard.
- Added source-evidence based candidate mining with Japanese/webnovel stoplists packaged under `noveltrans.data`.
- Added explicit glossary entry status handling (`pending`, `approved`, `locked`, `conflict`, `rejected`, `deprecated`) with alias and forbidden-target metadata.
- Added glossary pending-review, unlock, reject, conflict review, strictness, and update-mode actions to the terminal wizard.
- Added glossary CLI commands for listing, review, locking, forbidding targets, and resolving user-approved targets.
- Added glossary v2 SQLite fields plus occurrence and merge-decision audit tables.
- Added unresolved glossary conflict sections to TXT/EPUB glossary exports and quality reports.
- Added `docs/glossary.md` to document glossary lifecycle, prompt rules, QA behavior, conflict handling, and export policy.

### Removed

- Finalized DOCX removal from supported export formats. Explicit CLI/library requests for `docx` now fail with a clear message instead of being silently ignored.

### Changed

- Clarified README output-format guidance around the supported `TXT` and `EPUB` formats.
- Legacy project manifests that still contain `docx` are normalized to the remaining supported formats when loaded.
- Glossary QA now understands aliases and reports forbidden glossary targets.
- Translation prompts now split glossary context into locked, accepted, and candidate groups.
- Model `new_terms` are parsed as glossary proposals, not directly trusted entries.
- Model-proposed glossary targets no longer silently overwrite approved terms; disagreements become reviewable conflicts.
- Glossary strictness now controls QA scope, locked-term warning severity, and automatic update behavior.
- Global term consistency reports now respect glossary matching policies such as spacing-flexible and alias-aware matching.

### Fixed

- Prevented targetless candidate terms from being locked through CLI or wizard flows.
- Fixed mismatch where CLI/TUI showed unresolved glossary conflicts but TXT/EPUB glossary appendices hid them.

## [1.0.8] - 2026-05-27

### Fixed

- Changed the package license metadata to the setuptools-compatible `license = "MIT"` format so frozen `uv sync` builds no longer fail while validating `project.license`.

## [1.0.7] - 2026-05-27

### Changed

- Rewrote the README in Korean with a task-oriented structure covering installation, wizard usage, CLI examples, authentication, site policy, project layout, development, plugins, and license information.
- Clarified that Settings and new-project flows share the same controls for source input, speed, translation mode, output, and review settings.

### Added

- Added the MIT license file and package license-file metadata.

## [1.0.6] - 2026-05-27

### Changed

- Reworked the terminal wizard home screen around user tasks: new translation, resume, export regeneration, and tools/settings.
- New translation projects now start with source input, then show a compact ready-to-translate summary with source, range, output, translation mode, speed, and review state.
- Settings are now grouped into authentication, translation defaults, output defaults, safety/policy, and advanced tuning instead of exposing every option at once.
- Settings and per-project start flows now share selection controls for source input, speed, translation mode, output formats, and review options.
- Translation mode changes now update the actual style, temperature, glossary strictness, and reasoning defaults used by new projects.

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
- TXT and EPUB exporters implemented with the Python standard library.
- Verification, status, estimate, report, policy import/refresh/show, and credential management CLI commands.
- Connector plugin entry point support under `noveltrans.connectors`.
- CI workflow and test suite covering connectors, policies, preprocessing, workflow resume, exporters, credentials, and translator parsing.

### Security

- Requires rights and non-redistribution confirmations for non-interactive source workflows.
- Blocks automated body fetch for restricted sites and avoids cookie import, CAPTCHA bypass, paywall bypass, and login-session scraping.
- Stores OpenAI API keys or bearer tokens through keyring when available, with a local restricted-permission encrypted fallback.
