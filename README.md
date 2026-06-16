# claude-code-optimizer-pro

A production-ready CLI to reduce token usage in Claude Code sessions and stabilize context quality.

This repository implements token-optimization capabilities (measure/compress/prune/hooks/diff/update) directly inside the `cco` CLI flow, aligned with the behavior of the `claude-code-optimizer-pro` project goals.

This document reflects the **current implemented behavior in this workspace**.

---

## Version and install

```bash
npm install -g claude-code-optimizer-pro
# or
npx claude-code-optimizer-pro <command>
```

Entry point:

- `cco`
- alias `claude-optimize`

## Why this tool exists

Claude Code pays context overhead every session:

- `.claudeignore` controls which project files are excluded from auto context reads.
- `CLAUDE.md` is loaded on each turn and can silently dominate token budget.
- Settings and path-scoped command files shape how much overhead is paid per request.

This CLI is built around three ideas:

1. generate compact project context (`init`),
2. continuously audit/repair drift (`audit`, `doctor`, `watch`),
3. optimize existing `CLAUDE.md` content over time (`measure`, `compress`, `prune`, `diff`).

---

## Quick start

```bash
cd my-project

# 1) scaffold baseline files
cco init

# 2) review current context health
cco audit
cco doctor --fix
cco stats
cco measure

# 3) reduce noise in CLAUDE.md (if present)
cco compress
cco prune --yes
cco diff

# 4) manage hooks when needed
cco hooks list
cco hooks install --all
cco hooks settings

# 5) keep package and templates fresh
cco update --content
```

---

## Feature scope implemented now

- [x] Core optimizer scaffold and diagnostics (`init`, `scan`, `analyze`, `audit`, `doctor`, `stats`, `watch`, `explain`).
- [x] Token-optimizer set: `measure`, `compress`, `prune`, `diff`.
- [x] Hook template lifecycle via `hooks` subcommands.
- [x] Self- and content-update flow via `update`.
- [x] Exported API surface updated in `lib/index.js`.

**Current parity caveat**: command output format and some implementation details are intentionally aligned to `cco`’s existing behavior, not necessarily byte-for-byte identical to original token-optimizer output.

---

## Commands in detail

Below are the exact commands and current behavior.

### Global flow

#### `cco init`

Creates baseline optimization files in the current directory.

Options:

- `--lang <language>` (default: `auto`)
- `--framework <name>` (default: `auto`)
- `--preset <name>` (default: `auto`)
- `--monorepo`
- `--analyze`
- `--review`
- `--force`

What it writes:

- `.claudeignore`
- `CLAUDE.md`
- `.claude/settings.json`
- `.claude/commands/api-rules.md`
- `.claude/commands/test-rules.md`
- `.claude/commands/ui-rules.md`
- `.claude/subagents/explore.md`
- `.claude/subagents/refactor.md`

With `--analyze`, it can additionally write richer context files:

- `.cco/context-map.md`
- `.cco/context-gaps.json`
- `.claude/summaries/backend.md`
- `.claude/summaries/frontend.md`

`--force` overwrites existing outputs when explicitly allowed.

---

#### `cco scan`

Non-writing repository scanner.

- Default scan uses safe defaults in `lib/scanner.js`.
- `--json` prints raw JSON.
- Use `--max-files` and classifies top-level structure into internal roles.

---

#### `cco analyze`

Runs deep but bounded repository analysis.

- Default classification mode based on extension and source heuristics.
- `--json`, `--cache`, `--max-files`, `--sample-files`.

Useful for previewing what `cco init --analyze` would encode.

---

#### `cco audit`

Checks existing files and project config for avoidable token costs and risky patterns.

Flags:

- `--json`
- `--markdown`
- `--sarif`
- `--ci`

Checks performed:

- `CLAUDE.md` exists.
- `CLAUDE.md` line count against `maxClaudeMdLines`.
- `CLAUDE.md` token estimate against `maxClaudeMdTokens`.
- presence of heavy/costly patterns in `CLAUDE.md`:
  - too many code fences,
  - very long file,
  - references that should be ignored.
- `CLAUDE.md` does not keep completed/session sections that should be archived.
- `.claudeignore` exists and contains critical entries.
- `.claude/settings.json` is valid and has `bash.maxOutputLength`.
- `.claude/commands/` exists and has content.

Extra checks added in this branch:

- `.claude/sessions/`
- `.claude/completions/`
- `docs/archive/`
- top-level noise files (`README.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `GEMINI.md`, `AGENTS.md`)
- rule files (`.cursorrules`, `.windsurfrules`, `.clinerules`, `.roomodes`)

When issues exist, actionable text suggests `cco init --force` (legacy-style) and/or doctor fixes.

---

#### `cco doctor`

Runs same checks as `cco audit`, and when `--fix` is set performs conservative auto-repairs.

Flags:

- `--fix`
- `--json`
- `--ci`

Fixes currently implemented:

- create `.cco.json` only if missing (`writeDefaultConfig`),
- append missing critical `.claudeignore` entries,
- ensure `.claude/settings.json` has safe `bash.maxOutputLength` (defaults to `20000`),
- sanitize generated `CLAUDE.md` line about node_modules guidance,
- add a conservative `files` field in `package.json` when missing and safe.

---

#### `cco stats`

Simple token report for current `CLAUDE.md`.

- Shows estimated token load and section-level details.
- Includes rough cost context for token burn.

---

#### `cco watch`

Runs an immediate optimizer snapshot and optionally keeps watching files.

- `--once` runs one snapshot and exits.
- `--debounce <ms>` sets fs-watch debounce (default `300`).

Monitors key files:

- `CLAUDE.md`
- `.claudeignore`
- `.claude/settings.json`
- `.claude/commands/`
- `.claude/subagents/`

---

#### `cco explain [topic]`

Prints concise educational explanations for optimizer concepts:

- `.claudeignore`
- `CLAUDE.md`
- `watch`
- `doctor`
- etc.

---

### New token-optimizer command set (implemented)

#### `cco measure`

Purpose: estimate how many tokens are currently auto-loadable from docs/context and whether init/compress applies.

Current behavior:

- Scans:
  - root-level `*.md` and `*.txt`
  - markdown files under `.claude/`
  - markdown files under `docs/`
- Applies `.claudeignore` pattern filtering.
- Computes token estimates via `estimateTokens()`.
- Sorts files by token contribution desc.

Logic:

- If `CLAUDE.md` is missing → treats as uninitialized and suggests `cco init`.
- If initialized → compares against configured budget and suggests compression when needed.

Output includes:

- auto-loadable file list with per-file tokens,
- total token baseline,
- post-init estimate for not-yet-initialized projects,
- actionable next step.

---

#### `cco compress`

Purpose: compact `CLAUDE.md` with deterministic low-risk rules.

Behavior:

- validates `CLAUDE.md` exists; if not, exits with guidance to `cco init`.
- calculates before/after token estimates.
- operations:
  - collapse repeated blank-line groups (`\n{3,}` → `\n\n`),
  - shorten code-fence labels (`javascript`, `typescript`, `python`, `ruby`, `golang`, `shell`, `bash`, `dockerfile`),
  - truncate long list blocks.
- default list truncation: keep 5 items, aggressive mode: keep 3.
- `--dry-run` prints report only.
- default creates `CLAUDE.md.bak`; disable with `--no-backup`.
- asks for confirmation `Apply changes? [y/N]` unless no-op.

Output:

- before tokens,
- after tokens,
- `%` reduction,
- applied change list.

Flags:

- `--dry-run`
- `--aggressive`
- `--backup` (default on)
- `--no-backup`

---

#### `cco prune`

Purpose: remove stale sections and optionally archive them.

Detection logic:

- heading beginning with `completed`, `done`, or starting `✓` → archived to `.claude/completions/`.
- heading matching `YYYY-MM-DD*` → archived to `.claude/sessions/archive/`.
- empty sections at level ≥ 2 (no content, no child section) → deleted.

Flow:

- scans `CLAUDE.md` and builds section list.
- interactive apply-by-section flow unless `--yes`.
- `--dry-run` only prints targets.
- default creates `CLAUDE.md.bak` before write.
- archived sections are written as:
  - `.claude/completions/<YYYY-MM-DD>-pruned-<slug>.md`
  - `.claude/sessions/archive/<YYYY-MM-DD>-pruned-<slug>.md`
- final file is rewritten and cleaned-up for excessive blank lines.
- prints cumulative token savings and final token delta.

Flags:

- `--yes`
- `--dry-run`
- `--backup` (default on)
- `--no-backup`

---

#### `cco diff`

Purpose: compare current file content with `.bak` backup.

- default file: `CLAUDE.md`
- `--file <path>` compare any file with `<path>.bak`
- if backup missing, prints instructions to run `cco compress` or `cco prune` first.
- reports:
  - before/after token totals,
  - saved/added tokens and percent,
  - line count diff.

---

#### `cco hooks`

Hook lifecycle management.

Subcommands:

- `cco hooks list`
- `cco hooks install <name>`
- `cco hooks install --all`
- `cco hooks remove <name> [-y]`
- `cco hooks status`
- `cco hooks settings`

Template source:

- `templates/hooks/*.sh`

Parsing:

- reads script header metadata:
  - `# EVENT:`
  - `# DESCRIPTION:`

Install behavior:

- copies to `.claude/hooks/` in repo,
- sets executable bit (`0755`).

Status:

- installed hooks include file modification age (minutes since last change).

Settings output:

- `cco hooks settings` prints JSON in the shape:

```json
{
  "hooks": {
    "<event>": [
      {
        "hooks": [
          { "type": "command", "command": "bash .claude/hooks/<hook-file>.sh" }
        ]
      }
    ]
  }
}
```

This output is intended to be merged into `~/.claude/settings.json`.

---

#### `cco update`

Two modes:

- `cco update`: version update
  - checks npm for latest package version,
  - if already current → prints up-to-date,
  - if update needed and package is global install → runs `npm install -g claude-code-optimizer-pro@<latest>`,
  - if not global → prints install command.

- `cco update --content`: project refresh
  - runs `doctor({ fix: true })`,
  - refreshes installed hook scripts from bundled templates,
  - prints concise action report.

---

## File behavior and side effects

### `CLAUDE.md`

- central always-loaded instruction file.
- target budgets derive from `.cco.json`:
  - `maxClaudeMdLines` (default `200`)
  - `maxClaudeMdTokens` (default `2000`)
  - `targetClaudeMdTokens` (default `1500`)
- touched by:
  - `init`, `doctor`, `compress`, `prune`.

### `.claudeignore`

- excludes noise from auto-load and scans.
- updated by:
  - `init`
  - `doctor --fix`

Critical entries currently tracked by this workspace:

- `node_modules/`, `dist/`, `.git/`, `*.log`, `.env`
- plus stricter/extended entries in `doctor` default fix path:
  - `.claude/sessions/**`, `.claude/completions/**`, `docs/archive/**`,
  - `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `GEMINI.md`, `AGENTS.md`,
  - `.cursorrules`, `.windsurfrules`, `.clinerules`, `.roomodes`.

### `.claude/settings.json`

- created/updated by `init` and repaired by `doctor --fix`.
- `bash.maxOutputLength` capped to `20000` when missing or too high.

### `.cco.json`

Config file for optimizer thresholds.

Default shape:

```json
{
  "maxClaudeMdLines": 200,
  "maxClaudeMdTokens": 2000,
  "targetClaudeMdTokens": 1500,
  "maxBashOutputLength": 20000,
  "maxLargeFileBytes": 500000,
  "requiredIgnoreEntries": ["node_modules", "dist", ".git", "*.log", ".env"],
  "ciFailOnWarnings": true
}
```

---

## Internal token estimates

Token estimation uses `lib/token.js` backed by `@anthropic-ai/tokenizer`.

- closer to real Claude tokenization than heuristic word-count estimates,
- used by:
  - `cco measure`
  - `cco compress`
  - `cco prune`
  - `cco diff`
  - `cco stats`
  - `cco watch`
  - `cco audit`

---

## Current implementation notes

- `hooks` commands rely on shell templates existing in `templates/hooks`.
- `update --content` refreshes installed hooks but does not yet reproduce every legacy content section-append behavior.
- `measure` in this branch uses Pro scanning/token logic (project files + config target) rather than the CTO synthetic post-init file model.
- this README intentionally reflects behavior as implemented now, not theoretical parity.

If you need a strict parity mode, we can document or implement:

1. exact legacy `measure` after-init simulation model,
2. section-template append updates on `update --content`,
3. final output text/formats matching original CTO CLI.

---

## Contributing and tests

This repo includes test scaffolding and additional new tests for ignore utils and optimizer commands.

(Execute tests locally only if needed for your branch workflow.)

## License

MIT
