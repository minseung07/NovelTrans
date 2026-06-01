# NovelTrans

NovelTrans is a TypeScript CLI/TUI tool for translating long-form Japanese novel text into Korean as a resumable project.

It is built for workflows where one source contains many episodes, repeated character names, setting terms, item names, author notes, and glossary-sensitive text. NovelTrans keeps the source, episode state, translations, glossary candidates, QA issues, logs, and TXT/EPUB exports together in one project directory.

Version: `2.2.0`  
Status: public npm package with the v2 terminal app enabled by default

## What It Does

- Imports local TXT files, stdin, inline pasted text, Kakuyomu works, and Syosetu/Shosetsuka ni Naro works.
- Splits common Japanese web-novel headings into episodes, with foreword/afterword detection.
- Translates as a resumable project with per-episode state, concurrent workers, pause/cancel support in the TUI, and retry-only-failed workflows.
- Tracks glossary candidates, confirmed terms, locked terms, conflicts, and forbidden translations.
- Runs QA for empty translations, remaining Japanese text, missing paragraphs, number mismatches, unusual length ratio, locked/confirmed glossary violations, forbidden terms, and name inconsistency.
- Lets the v2 TUI triage glossary and QA queues with filters, grouped QA issue views, and targeted or batch QA retranslation.
- Exports translated episodes to TXT and EPUB, with optional glossary appendix, afterword inclusion, EPUB vertical writing, and EPUB cover image support in project metadata.
- Supports three translation backends: `dry-run`, `openai-compatible`, and `codex-cli`.
- Publishes generated runtime artifacts to npm; `dist/` is build output and is not source.

## Requirements

- Node.js `>=22.5.0`
- npm
- Optional: an OpenAI-compatible API key for `openai-compatible`
- Optional: Codex CLI installed and logged in for `codex-cli`

NovelTrans uses Node's built-in `node:sqlite` `DatabaseSync` for per-project state. In Node 22 this API is still experimental; NovelTrans suppresses that specific runtime warning internally.

## Installation

From npm:

```bash
npm install -g noveltrans
```

After installation:

```bash
noveltrans help
```

Release packages include generated `dist/` files. The repository treats `dist/` as ignored build output.

## Quick Start

Run the built-in smoke workflow with the default `dry-run` backend:

```bash
noveltrans self-test --workspace tmp/self-test
```

Create a project from a local TXT file:

```bash
noveltrans import --source source.txt --name "My Novel" --workspace projects
```

Translate the project:

```bash
noveltrans translate --project projects/my-novel --backend dry-run
```

Check status:

```bash
noveltrans status --project projects/my-novel
```

Export translated episodes:

```bash
noveltrans export --project projects/my-novel --formats txt,epub
```

Open the terminal app:

```bash
noveltrans app --workspace projects
```

When run with no arguments in an interactive terminal, `noveltrans` opens the v2 terminal app. In non-interactive output, it prints a plain bookshelf snapshot.

`dry-run` is for smoke tests and workflow checks only. It creates placeholder Korean text, not real translations.

## Terminal App

The active app is the dependency-free v2 TUI in `src/ui-v2/`.

Main screens:

- Library: project list, search, import, settings, and first-run setup.
- Project Workspace: Overview, Source, Translate, Glossary, QA, and Export stages.

Common keys:

```text
↑/↓ or j/k   Move
Enter        Open/select
Esc or b     Back
1-6          Jump project stage
N            Import from Library
S            Settings from Library
T            Start/continue translation from Project
: or Ctrl+K  Command palette
?            Help
Q or Ctrl+C  Quit
```

Stage-specific keys are shown in the in-app help. The app also accepts committed single-key Korean two-set keyboard input for shortcuts where supported.

## Importing Sources

Local TXT:

```bash
noveltrans import --source source.txt --name "My Novel" --workspace projects
```

Inline text:

```bash
noveltrans import --text "第1話 黒架\n黒架は第七区で聖印を見た。" --name "Pasted Novel"
```

stdin:

```bash
cat source.txt | noveltrans import --stdin --name "Pipe Import"
```

Web import:

```bash
noveltrans import --url https://kakuyomu.jp/works/... --episodes 1-10
```

Supported range forms:

```text
1
1-10
11-
latest-5
all
```

Supported sites:

- Kakuyomu work URLs under `kakuyomu.jp/works/...`
- Syosetu/Shosetsuka ni Naro work URLs under `ncode.syosetu.com/...`

Web import uses an HTTPS allowlist, rejects redirects, waits between requests, and reports blocked/rate-limited pages. Only import public/free episodes that you have the right to process for personal translation work.

In the TUI, press `N`, paste only the URL, then enter an episode range such as `1-10`, `latest-5`, or `all`. Do not append command flags to the URL input.

## Translation Backends

### dry-run

The default backend is always available and is useful for testing project flow:

```bash
noveltrans translate --project projects/my-novel --backend dry-run
```

The CLI prints a warning before using `dry-run` because it does not call a real translator.

### openai-compatible

Initialize and inspect config:

```bash
noveltrans config init
noveltrans config show
```

Set the backend and model:

```bash
noveltrans config set --backend openai-compatible --openai-model gpt-5.5
```

Set an API key with an environment variable:

```bash
export OPENAI_API_KEY=sk-...
```

or store it locally:

```bash
noveltrans auth set-openai-key --api-key sk-...
```

Then translate:

```bash
noveltrans translate --project projects/my-novel --backend openai-compatible
```

The default API base URL is `https://api.openai.com/v1`. Override it with:

```bash
export NOVELTRANS_API_BASE_URL=https://example.com/v1
```

or:

```bash
noveltrans config set --base-url https://example.com/v1
```

OpenAI-compatible base URLs must use `https://` so bearer tokens are not sent over cleartext HTTP.

### codex-cli

Use this backend when Codex CLI is installed and authenticated:

```bash
codex login status
noveltrans config set --backend codex-cli --codex-model gpt-5.5
noveltrans translate --project projects/my-novel --backend codex-cli
```

NovelTrans calls Codex CLI in ephemeral `exec` mode with a read-only translation sandbox and asks it to return strict JSON translation output.

## Glossary and QA

Show glossary summary:

```bash
noveltrans glossary --project projects/my-novel summary
```

Review conflicts:

```bash
noveltrans glossary --project projects/my-novel conflicts
```

Confirm and lock a term:

```bash
noveltrans glossary --project projects/my-novel set --source 黒架 --target 흑가 --lock
```

Add a forbidden translation:

```bash
noveltrans glossary --project projects/my-novel forbid --source 聖印 --target 성스러운 도장
```

Discard a candidate:

```bash
noveltrans glossary --project projects/my-novel discard --source 聖印
```

Rerun QA:

```bash
noveltrans qa --project projects/my-novel
```

Translations are written as both JSON and Markdown. If a translated episode Markdown file is edited and is newer than its JSON file, QA rechecks and exports read the Markdown edits.

## Export

Generate configured formats:

```bash
noveltrans export --project projects/my-novel --formats txt,epub
```

TXT and EPUB exports are written under:

```text
<project>/exports/
```

Export behavior is controlled by project metadata:

- `formats`: `txt`, `epub`, or both
- `includeGlossaryAppendix`: include confirmed/locked glossary terms
- `includeAfterword`: include translated afterword sections
- `verticalWriting`: use vertical writing CSS in EPUB
- `coverImagePath`: optional EPUB cover image path; supports `.jpg`, `.jpeg`, `.png`, and `.webp`

## Commands

```text
noveltrans app [--workspace projects]
noveltrans ui [--workspace projects]
noveltrans bookshelf [--workspace projects]

noveltrans import --source source.txt [--name Title] [--workspace projects]
noveltrans import --text "..." [--name Title] [--workspace projects]
noveltrans import --stdin [--name Title] [--workspace projects]
noveltrans import --url https://kakuyomu.jp/works/... --episodes 1-10
noveltrans create ...

noveltrans translate --project projects/title [--backend dry-run] [--model gpt-5.5] [--concurrency 2]
noveltrans retry --project projects/title
noveltrans status --project projects/title

noveltrans studio --project projects/title
noveltrans glossary-lab --project projects/title
noveltrans lab --project projects/title
noveltrans review-desk --project projects/title
noveltrans review --project projects/title
noveltrans failure-recovery --project projects/title [screen|skip-and-export|logs]
noveltrans recover --project projects/title [screen|skip-and-export|logs]
noveltrans export-room --project projects/title
noveltrans room --project projects/title
noveltrans palette [--project projects/title] [--query glossary]

noveltrans glossary --project projects/title [summary|conflicts|set|confirm|forbid|discard|deprecate]
noveltrans export --project projects/title --formats txt,epub
noveltrans export --project projects/title --format txt --format epub
noveltrans qa --project projects/title

noveltrans config [show|init|set]
noveltrans auth status
noveltrans auth set-openai-key --api-key sk-...
noveltrans auth set-openai-key --stdin
noveltrans auth clear-openai-key
noveltrans credentials ...

noveltrans self-test --workspace tmp/self-test
noveltrans help
```

Global options used by commands that load config:

```text
--workspace <path>   Project root, default ./projects
--config-dir <path>  Config and credential directory, default ~/.config/noveltrans
```

## Data Locations

Default config:

```text
~/.config/noveltrans/config.json
```

Default credential store:

```text
~/.config/noveltrans/credentials.json
```

Override config directory:

```bash
NOVELTRANS_CONFIG_DIR=/path/to/config noveltrans config show
```

Default project root:

```text
./projects
```

Override per command with `--workspace`.

Project layout:

```text
<project>/
  project.json
  project.db
  source/
    original.txt
    episode_00001.json
  translated/
    episode_00001.json
    episode_00001.md
  glossary/
    glossary.json
    conflicts.json
    forbidden.json
  logs/
    episode_00001.qa.json
    quality_report.json
    quality_report.txt
    translation.log
    qa.log
    glossary.log
    export.log
    error.log
  exports/
    <title>.txt
    <title>.epub
```

New episode artifacts use 5-digit padding, such as `episode_00001.json`. The storage layer still reads legacy 3-digit episode artifacts from older projects.

## Credential Notes

`OPENAI_API_KEY` takes precedence over the local credential store.

The local credential file stores the API key outside plain config text as an AES-256-GCM envelope and writes the file with user-only permissions where the platform supports them. Its key material is derived from the current user, host, and config directory, so moving the credential file may make it unreadable.

This is useful against accidental exposure in config files, but it is not a substitute for an OS keychain, hardware-backed secret store, or user-supplied passphrase.

## Development

Install dependencies:

```bash
npm install
```

Build production files:

```bash
npm run build
```

Build test files:

```bash
npm run build:test
```

Run tests:

```bash
npm test
```

Run the smoke workflow:

```bash
npm run smoke
```

Check package contents:

```bash
npm run pack:check
```

Runtime source lives in `src/`. `dist/` is generated and ignored by git.

Important source areas:

```text
src/cli/          CLI parsing and commands
src/engine/       import, episode lifecycle, translation sessions, QA reruns
src/translation/  dry-run, OpenAI-compatible, and Codex CLI adapters
src/glossary/     glossary candidate/conflict logic
src/qa/           QA checks
src/export/       TXT/EPUB exporters
src/webImport/    Kakuyomu and Syosetu import
src/storage/      project files and SQLite state
src/ui/           reusable UI data/action helpers
src/ui-v2/        active terminal app
```

Architecture notes are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). The completed v2 TUI migration checklist is in [docs/UI_V2_PLAN.md](docs/UI_V2_PLAN.md).

## Release

GitHub Actions publishes to npm from the `Release` workflow only when the workflow is manually dispatched with a tag. Creating a git tag or publishing a GitHub Release does not publish to npm automatically.

The npm package must have Trusted Publishing configured with:

```text
Provider: GitHub Actions
Organization/user: minseung07
Repository: NovelTrans
Workflow filename: release.yml
Environment name: npm
Allowed action: npm publish
```

The release tag must match `package.json` exactly as `v<version>`, for example `v2.2.0`.

Before publishing a release:

```bash
npm test
npm run smoke
npm run pack:check
```

The release workflow runs tests, smoke, package checks, verifies the selected tag against `package.json`, publishes with `npm publish --provenance`, and checks npm provenance metadata.

## Release Notes

See [CHANGELOG.md](CHANGELOG.md).

## License

MIT
