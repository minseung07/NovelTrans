# NovelTrans

NovelTrans is a TypeScript CLI/TUI tool for translating long-form Japanese novel text into Korean as a resumable project.

It is built for workflows where one source contains many episodes, repeated character names, setting terms, item names, and other glossary-sensitive text. NovelTrans keeps the source, episodes, translation state, glossary candidates, QA issues, logs, and TXT/EPUB exports together in one project directory.

Version: `2.0.2`  
Status: initial public release

## Features

- Project-based novel translation workflow
- Local TXT import, stdin import, inline text import, and supported web import
- Episode splitting for common Japanese novel headings
- Resume translation and retry only failed episodes
- Glossary candidate extraction, confirmation, locking, conflicts, and forbidden translations
- QA checks for remaining Japanese text, number mismatches, length ratio, and glossary consistency
- TXT and EPUB export
- Terminal app plus command-based workflows
- Translation backends: `dry-run`, `openai-compatible`, and `codex-cli`
- GitHub install support through npm `prepare`

## Requirements

- Node.js `>=22.5.0`
- npm
- Optional: OpenAI-compatible API key for `openai-compatible`
- Optional: Codex CLI installed and logged in for `codex-cli`

## Installation

From GitHub:

```bash
npm install -g github:minseung07/NovelTrans
```

After installation:

```bash
noveltrans help
```

The GitHub install builds `dist/` during installation with the package `prepare` script. The repository can keep `dist/` ignored and publish only source files.

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

## OpenAI-Compatible Backend

Initialize and inspect config:

```bash
noveltrans config init
noveltrans config show
```

Set the backend and model:

```bash
noveltrans config set --backend openai-compatible --openai-model gpt-5.5
```

Set an API key with either environment variables:

```bash
export OPENAI_API_KEY=sk-...
```

or the local credential store:

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

## Codex CLI Backend

Use this backend when Codex CLI is installed and authenticated:

```bash
codex login status
noveltrans config set --backend codex-cli --codex-model gpt-5.5
noveltrans translate --project projects/my-novel --backend codex-cli
```

NovelTrans calls Codex CLI in ephemeral exec mode and asks it to return strict JSON translation output.

## Web Import

Supported sites:

- Kakuyomu
- Syosetu / Shosetsuka ni Naro

Example:

```bash
noveltrans import --url https://kakuyomu.jp/works/... --episodes 1-10 --confirm-rights
```

Only import public/free episodes that you have the right to process for personal translation work. URL import requires `--confirm-rights`.

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

Rerun QA:

```bash
noveltrans qa --project projects/my-novel
```

## Commands

```text
noveltrans app [--workspace projects]
noveltrans bookshelf [--workspace projects]
noveltrans import --source source.txt [--name Title] [--workspace projects]
noveltrans import --url https://kakuyomu.jp/works/... --episodes 1-10 --confirm-rights
noveltrans translate --project projects/title [--backend dry-run] [--model gpt-5.5]
noveltrans retry --project projects/title
noveltrans status --project projects/title
noveltrans studio --project projects/title
noveltrans glossary-lab --project projects/title
noveltrans review-desk --project projects/title
noveltrans failure-recovery --project projects/title [screen|skip-and-export|logs]
noveltrans export-room --project projects/title
noveltrans palette [--project projects/title] [--query glossary]
noveltrans glossary --project projects/title [summary|conflicts|set|forbid|discard]
noveltrans export --project projects/title --formats txt,epub
noveltrans qa --project projects/title
noveltrans config [show|init|set]
noveltrans auth status
noveltrans auth set-openai-key --api-key sk-... | --stdin
noveltrans auth clear-openai-key
noveltrans self-test --workspace tmp/self-test
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

## Development

Install dependencies:

```bash
npm install
```

Build:

```bash
npm run build
```

Run tests:

```bash
npm test
```

Run smoke workflow:

```bash
npm run smoke
```

Check package contents:

```bash
npm pack --dry-run
```

## Release Notes

See [CHANGELOG.md](CHANGELOG.md).

## License

MIT
