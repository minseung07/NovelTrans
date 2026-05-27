# NovelTrans CLI

`noveltrans` is a keyboard-driven terminal wizard for translating Japanese web novel text that the user is authorized to process. It is intentionally conservative: unsupported or risky sites are metadata-only and require user-provided text.

## What Works In v1

- Codex/Claude/Hermes-style command-palette terminal wizard launched with `noveltrans`
- Legacy prompt-based terminal UI preserved with `noveltrans --classic`
- Textual full-screen UI available with the same dark command-palette visual language via `noveltrans --textual`
- Local TXT/HTML/ZIP input, clipboard/manual paste, and `$EDITOR` source editing workflows
- Safety confirmations before project creation
- Site policy gate for Aozora, Syosetu metadata, Kakuyomu, Hameln, pixiv, and local files
- Episode-level async translation queue with resume support
- OpenAI Responses API translator using `gpt-5.5` by default
- Codex CLI translator backend using `codex login` credentials without reading API keys
- Dry-run translator for offline pipeline checks
- Glossary extraction, update, conflict tracking, and locking
- QA report generation
- TXT, DOCX, and EPUB export using only the Python standard library
- SQLite project database and file-based project layout
- Entry point for connector plugins via `noveltrans.connectors`
- Local site-policy update imports from JSON file or HTTPS URL

## Quick Start

Recommended, with the locked development environment:

```bash
make sync-frozen
.venv/bin/noveltrans
```

The default terminal wizard is controlled with arrow keys or `j`/`k`, Enter, and Space for multi-select prompts.

If you are not using `uv`, install the package into a virtual environment:

```bash
python3 -m venv .venv
. .venv/bin/activate
python3 -m pip install -e ".[dev]"
noveltrans
```

Use the legacy prompt UI if you want the old line-by-line flow:

```bash
noveltrans --classic
```

The full-screen Textual UI is available explicitly:

```bash
noveltrans --textual
```

For a non-interactive local-file smoke run:

```bash
noveltrans run-local --name demo --input sample.txt --dry-run --confirm-rights --no-redistribute --formats txt,docx,epub
```

For a real translation through a ChatGPT-authenticated Codex CLI instead of a Platform API key:

```bash
codex login
noveltrans auth codex-status
noveltrans run-local --name demo --input sample.txt --backend codex --confirm-rights --no-redistribute --formats txt,docx,epub
```

For a restricted URL with user-provided source text:

```bash
noveltrans run-url --name demo --url https://kakuyomu.jp/works/abc --fallback-file saved.txt --episodes 1-3 --dry-run --confirm-rights --no-redistribute
```

To append newly saved episodes to an existing project and translate only the added or pending items:

```bash
noveltrans add-source --project demo --input new_saved_episodes.txt --translate --dry-run --confirm-rights --no-redistribute
noveltrans status --project demo
noveltrans estimate --project demo
```

To regenerate output files from an existing translated project:

```bash
noveltrans export --project demo --formats txt,docx,epub
noveltrans report --project demo
noveltrans verify --project demo
```

To import and inspect site-policy updates without opening the menu:

```bash
noveltrans policy import --file policies.json
noveltrans policy import --url https://example.com/noveltrans-policies.json --save-url
noveltrans policy refresh
noveltrans policy show --site 青空
```

To check runtime configuration before a real translation run:

```bash
noveltrans doctor
noveltrans doctor --strict
noveltrans doctor --backend codex --strict
```

Dry-run mode validates the workflow and exports, but it does not perform real translation. Configure an OpenAI API key in the settings menu, set `OPENAI_API_KEY`, or use `--backend codex` after `codex login` for actual translation.

## Development Environment

The repository keeps two supported setup paths:

```bash
uv --cache-dir .uv-cache sync --dev
uv --cache-dir .uv-cache run pytest -q
uv --cache-dir .uv-cache run noveltrans --version
```

Or with plain `pip`:

```bash
python3 -m pip install -e ".[dev]"
python3 -m pytest -q
```

Useful local checks are also available through `make`:

```bash
make compile
make test
make test-unittest
make doctor
make smoke
```

`make test-unittest` runs with only the standard-library test runner and skips Textual UI tests when Textual is not installed. `make test` is the CI-equivalent pytest path and requires the dev dependencies.

## Terminal Wizard

The default `noveltrans` command opens a terminal-native command palette. The first screen provides:

- New project creation for URL or TXT/HTML/ZIP input
- Existing project resume, source import, translation, verification, and export
- Glossary add/update, lock, and conflict resolution
- Settings for default model, backend, Codex CLI command, token prices, watermark, and credentials

The non-interactive commands remain available for scripts and tests. The full-screen Textual interface can be launched with `noveltrans --textual`.

Credentials can also be managed without opening the menu:

```bash
noveltrans auth login
printf '%s\n' "$OPENAI_API_KEY" | noveltrans auth set-api-key --from-stdin
noveltrans auth status
noveltrans auth codex-status
noveltrans auth codex-login
noveltrans auth clear-api-key
```

## Authentication

For production translation calls, NovelTrans uses the OpenAI Responses API with a Platform API key by default. The settings menu can store an API key, organization ID, project ID, and a compatible OAuth/Bearer access token locally. API keys remain the recommended path for direct Responses API usage.

NovelTrans can also use the Codex CLI as a separate backend:

```bash
codex login
noveltrans run-local --name demo --input sample.txt --backend codex --confirm-rights --no-redistribute
```

The Codex backend checks `codex login status` and delegates each translation job to `codex exec`. It does not parse, copy, or modify Codex's cached credentials. The existing API key path is left intact; choose `--backend openai`, `--backend codex`, `--backend auto`, or `--backend dry-run` per run.

## Safety Policy

This tool does not support copyright infringement, paid-content bypass, login session theft, CAPTCHA bypass, or automated collection that violates a site policy. Sites without a safe automated access path are blocked from automatic body fetch and only accept user-provided source files.

Local credential fallback uses a per-user best-effort encrypted file with restrictive file permissions when OS keyring support is unavailable. Prefer system keychains for production use.

## Policy And Plugins

The settings menu can import site policy updates from JSON. A policy update can disable automated fetch for a site without changing connector code.

Third-party connectors are loaded from the `noveltrans.connectors` entry point group. See [docs/plugin_sdk.md](docs/plugin_sdk.md) and [examples/connectors/example_connector.py](examples/connectors/example_connector.py).
