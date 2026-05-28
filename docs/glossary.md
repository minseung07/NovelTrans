# NovelTrans Glossary v2 Policy

NovelTrans treats the glossary as a project knowledge base, not as the model's scratchpad. Model output is accepted only as a proposal, then validated and merged through a safety decision.

Core rule:

```text
Mine broadly, accept narrowly, never auto-replace an existing target.
```

## Storage

Each project stores glossary data under `glossary/`.

```text
glossary/
  glossary.json
  glossary.locked.json
  glossary.forbidden.json
  candidates.json
  proposals.jsonl
  conflicts.json
  decisions.jsonl
```

- `glossary.json`: active non-locked entries, including candidates and accepted terms.
- `glossary.locked.json`: read-only locked terms.
- `glossary.forbidden.json`: source-to-forbidden-target rules.
- `candidates.json`: mined source-side candidates with occurrence evidence.
- `proposals.jsonl`: model/rule/user translation proposals.
- `conflicts.json`: unresolved target disagreements.
- `decisions.jsonl`: merge-decision audit trail.

SQLite mirrors glossary fields in `glossary_entries` and includes `glossary_occurrences` and `glossary_decisions` tables for reporting/audit queries. File JSON remains the editing source of truth.

## Object Model

Glossary automation uses three separate concepts:

- `GlossaryCandidate`: source-side term found in the original text with occurrence evidence.
- `GlossaryProposal`: proposed Korean target from a model, rule, or user.
- `MergeDecision`: policy result deciding whether the proposal is safe to apply, should be kept for review, or creates a conflict.

`GlossaryEntry` is the durable knowledge-base record.

Important entry fields:

```json
{
  "source": "魔導機関",
  "target": "마도기관",
  "type": "organization",
  "status": "accepted_auto",
  "confidence": 0.91,
  "source_score": 0.82,
  "target_score": 0.91,
  "aliases": ["魔導エンジン"],
  "variants": ["마도 기관"],
  "forbidden_targets": ["마도 기관"],
  "occurrence_count": 4,
  "episode_count": 2,
  "first_seen_episode": 1,
  "last_seen_episode": 3,
  "origin": "auto",
  "matching_policy": "exact"
}
```

## Status Values

| Status | Meaning |
| --- | --- |
| `candidate` | Source-side term candidate. Target is not accepted. |
| `proposed` | A target proposal exists but needs review. |
| `accepted_auto` | Safe merge accepted the target automatically. |
| `accepted_user` | User-reviewed target. Auto changes are forbidden. |
| `locked` | Strongest read-only target. Auto changes are forbidden. |
| `forbidden` | Source or target should not be used. |
| `deprecated` | Historical term retained for audit only. |
| `needs_review` | Conflict or unsafe proposal requires user action. |

Legacy `pending`, `approved`, `rejected`, and `conflict` are read for compatibility and normalized internally.

## Candidate Mining

The miner combines several source signals:

- CJK compounds
- Katakana terms
- title hits
- ruby annotations
- suffix patterns for organizations, places, skills, titles, and items
- repeated `AのB` phrases

Candidates must keep `TermOccurrence` evidence:

```json
{
  "episode_no": 1,
  "section_type": "body",
  "start": 12,
  "end": 16,
  "text": "黒騎士",
  "context_before": "...",
  "context_after": "..."
}
```

Stoplists live in:

```text
src/noveltrans/data/stoplist-ja.txt
src/noveltrans/data/stoplist-webnovel-ja.txt
```

Supported stoplist directives:

- `=term`: exact skip
- `>prefix`: phrase-boundary/prefix skip
- `/regex/`: regex skip

## Prompt Contract

Translation prompts split glossary input into three groups:

```json
{
  "locked_glossary": [],
  "accepted_glossary": [],
  "candidate_terms": []
}
```

The model must:

- use locked targets exactly,
- prefer accepted targets,
- treat candidates as unconfirmed,
- return new `new_terms` only as proposals,
- avoid proposing a source that is not present in the input episode,
- report conflicts when it used a different target for accepted or locked terms.

`new_terms` items include evidence and usage metadata:

```json
{
  "source": "黒騎士",
  "target": "흑기사",
  "type": "title",
  "confidence": 0.84,
  "reason": "칭호로 반복 등장",
  "evidence_quote": "黒騎士は剣を抜いた",
  "alternative_targets": ["검은 기사"],
  "used_in_translation": true
}
```

## Validation And Merge

Every proposal is validated before merge. Rejections include:

- source not present in the episode text,
- empty target,
- stopword source,
- forbidden target,
- sentence-like target,
- excessive Japanese left in target,
- target too long for the source/type.

Safe automatic updates are limited to:

- filling an empty candidate target,
- strengthening the same target with more confidence/evidence,
- adding aliases, variants, evidence, or forbidden targets,
- promoting `candidate` or `proposed` to `accepted_auto`.

Unsafe updates are not applied by default:

- replacing an existing target,
- changing locked or `accepted_user` terms,
- changing canonical target choice,
- force-changing type,
- accepting low-evidence new terms.

Conflicts are recorded instead of hidden.

## Strictness And Update Modes

`TranslationOptions.glossary_strictness` controls QA and merge thresholds:

- `low`: candidate mining only, no automatic merge.
- `medium`: safe updates, locked-term QA.
- `high`: safe updates, accepted-term QA, forbidden-target checks.
- `strict`: high plus stricter merge threshold and locked-target warnings.

`TranslationOptions.glossary_updates` controls merge behavior:

- `off`: record proposals/decisions only.
- `safe`: apply safe updates only.
- `review`: record proposed targets without accepting them.
- `unsafe`: explicit opt-in for replacing `accepted_auto` or reviewable targets. It never changes `locked` or `accepted_user` terms, and strict mode still clamps it to safe.

## QA Rules

QA checks confirmed entries only: `accepted_auto`, `accepted_user`, and `locked`.

Issue codes:

- `glossary_target_missing`
- `glossary_alias_used`
- `glossary_forbidden_target_used`
- `glossary_locked_target_changed`
- `glossary_variant_suspected`
- `glossary_context_mismatch`

Matching policy is entry-specific:

- `exact`
- `spacing_flexible`
- `suffix_allowed`
- `alias_allowed`
- `contextual`

## CLI

```bash
noveltrans glossary list --project demo
noveltrans glossary review --project demo
noveltrans glossary lock --project demo --source 黒騎士
noveltrans glossary forbid --project demo --source 王都 --target "킹덤"
noveltrans glossary resolve --project demo --source 黒騎士 --use 흑기사
```

Translation run options:

```bash
noveltrans run-local \
  --glossary-updates safe \
  --glossary-strictness high
```

## Export Rules

TXT and EPUB glossary appendices include confirmed terms only. Candidate, proposed, forbidden, deprecated, and needs-review entries are excluded from exported glossary appendices.
