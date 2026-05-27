# claude-code-optimizer-pro

> Save 40–70% on Claude Code tokens. Get responses up to 100× faster with prompt caching.

A CLI tool that scaffolds all the config files and best-practice patterns needed to run Claude Code efficiently — zero setup friction.

---

## Install

```bash
# Global install (recommended)
npm install -g claude-code-optimizer-pro

# Or use without installing
npx claude-code-optimizer-pro init
```

---

## Quick Start

```bash
# Navigate to your project
cd my-project

# Scaffold all optimizer files
cco init

# Or scaffold with deeper repo analysis
cco init --analyze

# Review detected context before writing files
cco init --analyze --review

# Check your existing config for issues
cco audit

# Apply conservative fixes for common issues
cco doctor --fix

# See token cost of your CLAUDE.md
cco stats

# Watch config files and get live optimization feedback
cco watch
```

---

## What gets created

```
your-project/
├── .claudeignore                   ← blocks noise from Claude's context
├── CLAUDE.md                       ← lean project guide (<200 lines template)
├── .claude/
│   ├── settings.json               ← caps bash output, model config
│   ├── commands/
│   │   ├── api-rules.md            ← path-scoped: loads only for src/api/**
│   │   ├── test-rules.md           ← path-scoped: loads only for *.test.ts
│   │   └── ui-rules.md             ← path-scoped: loads only for src/ui/**
│   └── subagents/
│       ├── explore.md              ← subagent template for reading many files
│       └── refactor.md             ← subagent template for isolated refactors
```

`cco doctor --fix` may also create `.cco.json` for optimizer budgets and audit settings.

---

## How each file saves tokens

### `.claudeignore`
Claude reads your entire project tree to understand context. Without this file, it reads `node_modules`, `dist`, `.git`, logs — none of which help it code. This file blocks all that noise.

**Savings: High** — eliminates thousands of wasted tokens per session.

### `CLAUDE.md` (lean template)
The template keeps you under 200 lines with clear sections. Every byte in CLAUDE.md is re-sent to the model on every session. Trimming 100 lines saves tokens every single time.

**Savings: High** — directly proportional to what you trim.

### `.claude/settings.json`
Sets `bash.maxOutputLength: 20000`. Without this, a single `npm test` run can dump 200k+ characters into context when tests fail verbosely.

**Savings: Medium-High** — critical for projects with verbose test output.

### `.claude/commands/` (path-scoped rules)
Instead of putting all rules in CLAUDE.md (loaded always), these files load only when Claude is editing matching paths. API rules load when editing `src/api/**`. Test rules load when editing `*.test.ts`. Everything else is invisible.

**Savings: Medium** — proportional to how many irrelevant rules you had in CLAUDE.md.

### `.claude/subagents/` (subagent templates)
Subagents run in their own conversation — they don't pollute your main session's context. Use them when a task requires reading 5+ files. The subagent accumulates heavy context, returns only a summary.

**Savings: High for large tasks** — keeps main context clean.

---

## Session habits (paste into your team wiki)

| Situation | Action |
|---|---|
| Same task, conversation getting long | `/compact` |
| Switching to a completely new task | `/clear` |
| Check current session cost | `/cost` |
| Need to read many files | Spawn a subagent |
| Adding MCP tools | Do it BEFORE the session starts |
| Running tests | `npm test 2>&1 \| tail -n 100` |

---

## Commands

### `cco init`

```
Options:
  --lang <language>     auto | js | ts | php | python | go  (default: auto)
  --framework <name>    auto | next | react | express | wordpress-plugin | fastapi | none
  --preset <name>       auto | next | react | express | fastapi | npm-package | monorepo
  --monorepo            force monorepo-oriented guidance
  --analyze             scan safe repo files before writing Claude guidance
  --review              show detected context before writing files
  --force               overwrite existing files
```

By default, `cco init` detects common project details before writing `CLAUDE.md`:
- language
- framework
- package manager
- common source/test/docs folders
- package scripts for dev, test, lint, format, and build

With `--analyze`, `cco init` also scans safe source/config files to infer:
- test, database, auth, state, styling, and validation libraries
- API, component, test, and database folders
- conventions like Zod validation, Tailwind styling, import aliases, and colocated tests
- extra scoped command files such as `next-rules.md`, `database-rules.md`, `validation-rules.md`, and `styling-rules.md`
- WordPress plugin/theme context such as plugin headers, text domains, Composer PSR-4 autoload, hooks, AJAX nonces, capabilities, wpFluent tables, Vue/Vite admin apps, and generated context gaps

When analysis is enabled, extra context files may be generated:

```text
.claude/context-map.md
.claude/context-gaps.json
.claude/summaries/backend.md
.claude/summaries/frontend.md
```

### `cco scan`
Safely scans and classifies repository files without reading secrets or generated folders.

```bash
cco scan
cco scan --json
```

### `cco analyze`
Prints the repository analysis without writing files.

```bash
cco analyze
cco analyze --json
cco analyze --cache
```

The analyzer skips dependency/build/cache folders, secrets, and files above its size limit. `--cache` writes `.cco/cache/analysis.json`.

### `cco audit`
Checks your project for:
- CLAUDE.md over 200 lines
- CLAUDE.md over 2000 tokens
- Missing `.claudeignore` entries
- Uncapped bash output
- Empty commands directory

Options:
```
  --json                print machine-readable JSON
  --markdown            print a Markdown report
  --sarif               print a SARIF report for code scanning
  --ci                  exit with code 1 when issues are found
```

### `cco doctor`
Diagnoses the same config as `cco audit`. With `--fix`, it applies conservative repairs:
- Creates missing optimizer files without overwriting existing files
- Adds missing critical `.claudeignore` entries
- Sets `bash.maxOutputLength` to `20000` when missing or too high
- Cleans the known generated `node_modules` guidance from `CLAUDE.md`
- Creates `.cco.json` when missing
- Adds a safe npm `files` whitelist when publishing risk is detected

Options:
```
  --fix                 apply conservative fixes
  --json                print machine-readable JSON
  --ci                  exit with code 1 when issues remain
```

### `cco stats`
Prints a token cost breakdown of your CLAUDE.md with per-section analysis and daily/monthly cost estimates.

### `cco watch`
Runs an immediate optimizer snapshot, then watches Claude Code config files for changes:
- `CLAUDE.md`
- `.claudeignore`
- `.claude/settings.json`
- `.claude/commands/`
- `.claude/subagents/`

Use `cco watch --once` in scripts or CI to run one snapshot without staying attached.

`watch` also performs lightweight risk checks for root-level secrets, generated folders, and large files.

### `cco explain`
Explains why each optimizer part exists:

```bash
cco explain
cco explain .claudeignore
cco explain CLAUDE.md
cco explain watch
cco explain doctor
```

### `.cco.json`
Optional project-level optimizer config:

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

## Why prompt caching matters

Claude's API caches stable prefixes (system prompt + tools + conversation history). When a cache hit occurs:
- Input tokens are **~10× cheaper**
- Response starts **significantly faster** (no re-processing)

What breaks the cache:
- Changing the tool set mid-session
- Modifying CLAUDE.md mid-session
- Starting a new conversation without `/compact`

This tool helps you protect the cache by keeping your config stable and your instructions out of places they don't belong.

---

## License

MIT
