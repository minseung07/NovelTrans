# Changelog

All notable changes to NovelTrans CLI will be documented in this file.

## [1.0.0] - 2026-05-27

### Added

- Initial NovelTrans CLI release for authorized Japanese web novel translation workflows.
- Keyboard-driven terminal wizard launched with `noveltrans`, plus legacy `--classic` and Textual `--textual` interfaces.
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
- CI workflow and test suite covering connectors, policies, preprocessing, workflow resume, exporters, TUI mounting, credentials, and translator parsing.

### Security

- Requires rights and non-redistribution confirmations for non-interactive source workflows.
- Blocks automated body fetch for restricted sites and avoids cookie import, CAPTCHA bypass, paywall bypass, and login-session scraping.
- Stores OpenAI API keys or bearer tokens through keyring when available, with a local restricted-permission encrypted fallback.
