# claude-code-optimizer-pro Specification

## Purpose

`claude-code-optimizer-pro` is a Node.js CLI package that helps projects keep Claude Code context small, stable, and cheaper to process.

The package optimizes by scaffolding Claude Code configuration files, auditing existing configuration, estimating `CLAUDE.md` token cost, and watching optimizer files for live feedback.

## Runtime

- Node.js: `>=18.0.0`
- Module type: ESM
- CLI binaries:
  - `cco`
  - `claude-optimize`

## Commands

### `cco init`

Scaffolds Claude Code optimizer files into the current working directory.

Options:

- `--lang <language>`: `auto`, `js`, `ts`, `python`, or `go`; default `auto`
- `--framework <name>`: `auto`, `next`, `react`, `express`, `fastapi`, or `none`; default `auto`
- `--preset <name>`: `auto`, `next`, `react`, `express`, `fastapi`, `npm-package`, or `monorepo`; default `auto`
- `--monorepo`: force monorepo-oriented guidance
- `--analyze`: scan safe repository files before writing Claude guidance
- `--force`: overwrite existing generated files

Default detection:

- language from `tsconfig.json`, `package.json`, `go.mod`, `pyproject.toml`, or `requirements.txt`
- framework from package dependencies or common Python project files
- package manager from lockfiles
- common source/test/docs directories
- common package scripts for dev, test, lint, format, and build

Deep analysis with `--analyze`:

- Reads safe config files such as package, TypeScript, framework, test, Tailwind, Prisma, Python, and Go config files.
- Samples source files with safe extensions.
- Skips dependency, build, cache, VCS, virtualenv, secret, and oversized files.
- Detects API, component, test, and database paths.
- Detects framework, test, database, auth, state, styling, and validation libraries.
- Detects lightweight source conventions such as async/await, Zod usage, import aliases, React functions, and colocated tests.
- Writes richer `CLAUDE.md` facts and additional scoped command files when relevant.

Expected output files:

- `.claudeignore`
- `.cco.json` when created by `cco doctor --fix`
- `CLAUDE.md`
- `.claude/settings.json`
- `.claude/commands/api-rules.md`
- `.claude/commands/test-rules.md`
- `.claude/commands/ui-rules.md`
- additional analyzed command files when `--analyze` detects relevant stack features
- `.claude/subagents/explore.md`
- `.claude/subagents/refactor.md`

Non-force behavior:

- Existing files must not be overwritten.
- Missing files may be created.

### `cco analyze`

Analyzes the repository without writing files.

Options:

- `--json`: print machine-readable JSON
- `--max-files <n>`: maximum source files to inspect; default `80`
- `--sample-files <n>`: maximum source files to read for pattern detection; default `30`

Analysis output:

- detected project metadata
- architecture path groups
- package scripts and dependencies
- config files
- detected library categories
- lightweight source patterns
- inferred conventions
- risks or missing documentation notes

### `cco audit`

Audits Claude Code optimizer configuration in the current working directory.

Checks:

- `CLAUDE.md` exists.
- `CLAUDE.md` has 200 lines or fewer.
- `CLAUDE.md` is estimated at 2000 tokens or fewer.
- `CLAUDE.md` does not contain common bloat patterns.
- `.claudeignore` exists.
- `.claudeignore` contains critical entries:
  - `node_modules`
  - `dist`
  - `.git`
  - `*.log`
  - `.env`
- `.claude/settings.json` exists.
- `.claude/settings.json` defines `bash.maxOutputLength`.
- `bash.maxOutputLength` is not greater than `30000`.
- `.claude/commands/` exists and contains at least one scoped command file.

Options:

- `--json`: print machine-readable JSON
- `--markdown`: print a Markdown audit report
- `--sarif`: print a SARIF audit report
- `--ci`: exit with code `1` when issues are found

### `cco doctor`

Diagnoses the same optimizer configuration as `cco audit`.

Options:

- `--fix`: apply conservative fixes
- `--json`: print machine-readable JSON
- `--ci`: exit with code `1` when issues remain

Fix behavior:

- Create missing optimizer files without overwriting existing files.
- Add missing critical `.claudeignore` entries.
- Set `bash.maxOutputLength` to `20000` when missing or greater than `30000`.
- Clean known generated dependency-directory guidance from `CLAUDE.md`.
- Create `.cco.json` when missing.
- Add a safe npm `files` whitelist when a publishable package lacks one.

### `cco stats`

Estimates the token cost of `CLAUDE.md`.

Token estimate:

- Local tokenizer-style heuristic based on words, punctuation, long-token penalties, and code fences.

Reported data:

- line count
- estimated token count
- estimated daily cost
- estimated monthly cost
- section-level token breakdown

Cost assumptions:

- `$3.00` per million input tokens
- `10` sessions per day
- `30` days per month

### `cco watch`

Runs an immediate optimizer snapshot, then watches Claude Code optimizer files for changes.

Watched paths:

- `CLAUDE.md`
- `.claudeignore`
- `.claude/settings.json`
- `.claude/commands`
- `.claude/subagents`

Options:

- `--once`: run one snapshot and exit
- `--debounce <ms>`: debounce file changes; default `300`

Snapshot data:

- `CLAUDE.md` estimated token count
- audit issue count
- passing check count
- top audit issues
- suggestion when `CLAUDE.md` exceeds 1500 estimated tokens
- lightweight risk checks for secrets, generated folders, and large root files

### `cco explain`

Explains optimizer concepts.

Supported topics:

- `overview`
- `.claudeignore`
- `CLAUDE.md`
- `commands`
- `subagents`
- `watch`
- `doctor`

## Configuration

Optional project config file: `.cco.json`

Supported keys:

- `maxClaudeMdLines`
- `maxClaudeMdTokens`
- `targetClaudeMdTokens`
- `maxBashOutputLength`
- `maxLargeFileBytes`
- `requiredIgnoreEntries`
- `ciFailOnWarnings`

## Library Exports

The package main entrypoint is `lib/index.js`.

Expected exports:

- `init`
- `audit`
- `collectAudit`
- `printAudit`
- `doctor`
- `stats`
- `collectStats`
- `printStats`
- `watch`
- `runWatchSnapshot`
- `detectProject`
- `analyze`
- `analyzeRepository`
- `printAnalysis`
- `explain`
- `loadConfig`
- `writeDefaultConfig`
- `estimateTokens`

## Packaging

The npm package should publish only:

- `bin`
- `lib`
- `README.md`
- `SPEC.md`

Local Claude config files, generated examples, caches, and dependency folders should not be included in the npm tarball.

## Verification

Required checks before publishing:

```bash
npm test
node bin/cco.js --version
node bin/cco.js audit
node bin/cco.js audit --json
node bin/cco.js audit --markdown
node bin/cco.js audit --sarif
node bin/cco.js analyze --json
node bin/cco.js doctor
node bin/cco.js explain watch
node bin/cco.js stats
node bin/cco.js watch --once
npm pack --dry-run
```

Expected result:

- `npm test` passes.
- CLI version matches `package.json`.
- Audit passes on the repository's own Claude Code configuration.
- Stats prints a `CLAUDE.md` breakdown.
- Watch `--once` prints a snapshot and exits.
- Pack dry run includes only the intended package files.
