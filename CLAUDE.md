# Project Guide
<!-- claude-code-optimizer-pro: keep this file under 200 lines -->
<!-- Delete sections that don't apply. Lean = fewer tokens = faster. -->

## What this project is
<!-- One sentence. Be direct. -->
> TODO: Describe your project here.

## Tech stack
- Language: ts
- Framework: next
- Package manager: <!-- npm / pnpm / yarn / pip -->

## Repository structure
```
src/          # Application source
  api/        # Backend routes / controllers
  ui/         # Frontend components
  lib/        # Shared utilities
tests/        # Test files (mirror src/ structure)
docs/         # Documentation
```
<!-- Only list directories Claude needs to navigate. Omit generated dirs. -->

## Coding conventions
- Use `async/await` (no raw Promise chains)
- All functions must have JSDoc / type hints
- Errors: always throw typed errors, never silent catches
- Tests: place next to source file as `*.test.ts`

## Commands Claude should know
```bash
# Install
npm install

# Dev server
npm run dev

# Run tests
npm test 2>&1 | tail -n 100   # always pipe — don't flood context

# Lint + format
npm run lint
npm run format

# Build
npm run build
```

## Important conventions
- <!-- Add 3–5 critical project-specific rules here -->
- <!-- e.g.: "API routes live in src/api/, always use the shared ApiError class" -->

## What NOT to do
- Don't edit files in `dist/` or `build/` — they're generated
- Don't change the tool set mid-session (breaks prompt cache)
- Don't read dependency directories — they're in .claudeignore

## Subagent usage
- Spawn a subagent for any task requiring reading 5+ files at once
- Return only summaries from subagents — not raw file contents
- Use Haiku for exploration/search tasks, Sonnet for implementation

<!-- OPTIMIZER TIP: Run `cco audit` to check this file's token cost -->
