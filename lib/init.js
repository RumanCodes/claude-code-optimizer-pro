import fs from "fs-extra";
import path from "path";
import chalk from "chalk";
import ora from "ora";
import { detectProject } from "./detect.js";
import { analyzeRepository } from "./analyze.js";

export async function init(options) {
  const { force, quiet } = options;
  const cwd = process.cwd();
  const analysis = options.analyze ? await analyzeRepository(cwd, options) : null;
  const detected = analysis?.project || await detectProject(cwd, options);
  const { language: lang, framework } = detected;

  if (!quiet) {
    console.log(chalk.yellow(`\nInitializing optimizer in: ${cwd}`));
    console.log(chalk.gray(`  Language:  ${lang}`));
    console.log(chalk.gray(`  Framework: ${framework}`));
    if (analysis) console.log(chalk.gray(`  Analysis:  ${analysis.architecture.scannedFiles} source file(s) scanned`));
    console.log();
  }

  const tasks = [
    {
      label: "Creating .claudeignore",
      fn: () => writeClaudeIgnore(cwd, lang, force),
    },
    {
      label: "Creating CLAUDE.md",
      fn: () => writeClaudeMd(cwd, detected, force, analysis),
    },
    {
      label: "Creating .claude/settings.json",
      fn: () => writeSettings(cwd, force),
    },
    {
      label: "Creating .claude/commands/ (scoped rules)",
      fn: () => writeScopedCommands(cwd, lang, force, analysis),
    },
    {
      label: "Writing subagent prompt templates",
      fn: () => writeSubagentTemplates(cwd, force),
    },
  ];

  for (const task of tasks) {
    const spinner = quiet ? null : ora(task.label).start();
    try {
      await task.fn();
      if (spinner) spinner.succeed(chalk.green(task.label));
    } catch (err) {
      if (spinner) spinner.fail(chalk.red(`${task.label}: ${err.message}`));
      else throw err;
    }
  }

  if (!quiet) {
    console.log(chalk.cyan(`
✅ Done! Files created:
   .claudeignore              ← blocks noise files from context
   CLAUDE.md                  ← lean project instructions (<200 lines)
   .claude/settings.json      ← caps bash output at 20k chars
   .claude/commands/          ← path-scoped rules (only load when needed)
   .claude/subagents/         ← subagent prompt templates

${chalk.bold("Next steps:")}
  1. Edit CLAUDE.md with your project-specific facts
  2. Run ${chalk.cyan("cco audit")} to check for token waste
  3. In Claude Code, run /compact every ~50 turns
  4. Never add/remove MCP tools mid-session (breaks cache)
`));
  }
}

// ─────────────────────────────────────────
// Writers
// ─────────────────────────────────────────

async function writeClaudeIgnore(cwd, lang, force) {
  const dest = path.join(cwd, ".claudeignore");
  if (!force && await fs.pathExists(dest)) return;

  const langExtras = {
    python: "__pycache__/\n*.pyc\n*.pyo\n.venv/\nvenv/\n*.egg-info/\ndist/\n",
    go: "vendor/\n*.test\nbin/\n",
    js: "",
    ts: "",
  }[lang] || "";

  const content = `# claude-code-optimizer-pro — auto-generated .claudeignore
# Files listed here are invisible to Claude, saving tokens every session.

# Dependencies
node_modules/
.pnp/
.yarn/

# Build outputs
dist/
build/
out/
.next/
.nuxt/
.svelte-kit/

# Caches & generated
.cache/
*.lock
package-lock.json
yarn.lock
pnpm-lock.yaml
*.min.js
*.min.css
*.map
*.d.ts.map

# Logs
*.log
logs/
npm-debug.log*

# Test coverage
coverage/
.nyc_output/
lcov.info
*.lcov

# Version control
.git/
.hg/
.svn/

# IDE / OS
.DS_Store
Thumbs.db
.idea/
.vscode/settings.json
*.swp
*.swo

# Secrets — never let Claude read these
.env
.env.local
.env.*.local
*.pem
*.key
secrets/

${langExtras}
# Large data / media
*.csv
*.parquet
*.sql
*.dump
*.mp4
*.mov
*.zip
*.tar.gz
`;

  await fs.outputFile(dest, content);
}

function renderRepositoryStructure(sourceDirs) {
  if (sourceDirs.length === 0) {
    return `src/          # Application source
tests/        # Test files
docs/         # Documentation`;
  }

  return sourceDirs.map((dir) => `${dir}/`).join("\n");
}

function renderAnalyzedRepositoryStructure(project, analysis) {
  const rows = [];
  const add = (dir, note) => {
    if (dir && !rows.some((row) => row.startsWith(`${dir}/`))) rows.push(`${dir}/        # ${note}`);
  };

  project.sourceDirs.forEach((dir) => add(dir, "Project directory"));
  analysis.architecture.apiDirs.forEach((dir) => add(dir, "API/server code"));
  analysis.architecture.componentDirs.forEach((dir) => add(dir, "UI components"));
  analysis.architecture.testDirs.forEach((dir) => add(dir, "Tests"));
  analysis.architecture.databaseDirs.forEach((dir) => add(dir, "Database/schema"));

  return rows.length ? rows.join("\n") : renderRepositoryStructure(project.sourceDirs);
}

function renderCommands(commands) {
  const rows = [
    ["Install", commands.install],
    ["Dev server", commands.dev],
    ["Run tests", commands.test],
    ["Lint", commands.lint],
    ["Format", commands.format],
    ["Build", commands.build],
  ].filter(([, command]) => command);

  return rows.map(([label, command]) => `# ${label}\n${command}`).join("\n\n");
}

async function writeClaudeMd(cwd, project, force, analysis = null) {
  const dest = path.join(cwd, "CLAUDE.md");
  if (!force && await fs.pathExists(dest)) return;

  const libraries = analysis?.libraries;
  const techRows = [
    `- Language: ${project.language}`,
    `- Framework: ${project.framework}`,
    `- Package manager: ${project.packageManager}`,
    `- Monorepo: ${project.monorepo ? "yes" : "no"}`,
    libraries?.test?.length ? `- Testing: ${libraries.test.join(", ")}` : null,
    libraries?.database?.length ? `- Database: ${libraries.database.join(", ")}` : null,
    libraries?.auth?.length ? `- Auth: ${libraries.auth.join(", ")}` : null,
    libraries?.styling?.length ? `- Styling: ${libraries.styling.join(", ")}` : null,
    libraries?.validation?.length ? `- Validation: ${libraries.validation.join(", ")}` : null,
  ].filter(Boolean).join("\n");

  const conventions = analysis?.conventions?.length
    ? analysis.conventions.map((item) => `- ${item}`).join("\n")
    : `- Use \`async/await\` (no raw Promise chains)
- All functions must have JSDoc / type hints
- Errors: always throw typed errors, never silent catches
- Tests: place next to source file as \`*.test.ts\``;

  const risks = analysis?.risks?.length
    ? `\n## Analysis notes\n${analysis.risks.map((risk) => `- ${risk}`).join("\n")}\n`
    : "";

  const content = `# Project Guide
<!-- claude-code-optimizer-pro: keep this file under 200 lines -->
<!-- Delete sections that don't apply. Lean = fewer tokens = faster. -->

## What this project is
<!-- One sentence. Be direct. -->
> TODO: Describe your project here.

## Tech stack
${techRows}

## Repository structure
\`\`\`
${analysis ? renderAnalyzedRepositoryStructure(project, analysis) : renderRepositoryStructure(project.sourceDirs)}
\`\`\`
<!-- Only list directories Claude needs to navigate. Omit generated dirs. -->

## Coding conventions
${conventions}

## Commands Claude should know
\`\`\`bash
${renderCommands(project.commands)}
\`\`\`

## Important conventions
- <!-- Add 3–5 critical project-specific rules here -->
- <!-- e.g.: "API routes live in src/api/, always use the shared ApiError class" -->
${project.monorepo ? "- Keep package-specific rules close to the package that owns them\n- Prefer scoped commands for app/package-specific guidance" : ""}
${risks}

## What NOT to do
- Don't edit files in \`dist/\` or \`build/\` — they're generated
- Don't change the tool set mid-session (breaks prompt cache)
- Don't read dependency directories — they're in .claudeignore

## Subagent usage
- Spawn a subagent for any task requiring reading 5+ files at once
- Return only summaries from subagents — not raw file contents
- Use Haiku for exploration/search tasks, Sonnet for implementation

<!-- OPTIMIZER TIP: Run \`cco audit\` to check this file's token cost -->
`;

  await fs.outputFile(dest, content);
}

async function writeSettings(cwd, force) {
  const dest = path.join(cwd, ".claude", "settings.json");
  if (!force && await fs.pathExists(dest)) return;

  const settings = {
    bash: {
      maxOutputLength: 20000,
    },
    model: {
      default: "claude-sonnet-4-20250514",
      explore: "claude-haiku-4-5",
    },
    cache: {
      enabled: true,
      neverInvalidateTools: true,
    },
    _notes: {
      maxOutputLength: "Caps bash output — prevents log floods eating tokens",
      neverInvalidateTools: "Never add/remove MCP tools mid-session — breaks prompt cache",
    },
  };

  await fs.outputJson(dest, settings, { spaces: 2 });
}

function analysisScopedCommands(analysis, ext) {
  if (!analysis) return [];

  const commands = [];
  const libraries = analysis.libraries;
  const apiPaths = analysis.architecture.apiDirs.flatMap((dir) => [`${dir}/**/*.${ext}`, `${dir}/**/*.tsx`]);
  const componentPaths = analysis.architecture.componentDirs.flatMap((dir) => [`${dir}/**/*.${ext}`, `${dir}/**/*.tsx`]);

  if (analysis.project.framework === "next" || libraries.frameworks.includes("next")) {
    commands.push({
      file: "next-rules.md",
      paths: ["app/**/*.ts", "app/**/*.tsx", "pages/**/*.ts", "pages/**/*.tsx", "next.config.*"],
      content: `# Next.js Rules
<!-- Generated from repository analysis -->

- Keep server-only logic out of client components
- Prefer route handlers under \`app/api/\` when using the App Router
- Use framework data-fetching conventions instead of ad hoc client fetching
- Keep environment variable access on the server unless explicitly public
`,
    });
  }

  if (libraries.database.length > 0 || analysis.architecture.databaseDirs.length > 0) {
    commands.push({
      file: "database-rules.md",
      paths: [...analysis.architecture.databaseDirs.map((dir) => `${dir}/**/*`), `src/db/**/*.${ext}`, `src/server/**/*.${ext}`],
      content: `# Database Rules
<!-- Generated from repository analysis -->

- Keep database access in shared data/server helpers
- Validate inputs before database writes
- Add migration/schema notes when changing persistence behavior
- Test error paths for database failures
`,
    });
  }

  if (libraries.validation.includes("zod") || analysis.patterns.usesZod) {
    commands.push({
      file: "validation-rules.md",
      paths: [...apiPaths, `src/**/*.schema.${ext}`, `src/**/*.validation.${ext}`],
      content: `# Validation Rules
<!-- Generated from repository analysis -->

- Validate external input at module or route boundaries
- Prefer existing Zod schemas over duplicating shape checks
- Keep parse/validation errors explicit and user-safe
`,
    });
  }

  if (libraries.styling.length > 0 || componentPaths.length > 0) {
    commands.push({
      file: "styling-rules.md",
      paths: componentPaths.length ? componentPaths : [`src/**/*.tsx`, `components/**/*.tsx`],
      content: `# Styling Rules
<!-- Generated from repository analysis -->

- Follow the existing styling system before adding new patterns
- Preserve accessibility states for interactive UI
- Keep visual changes consistent with nearby components
`,
    });
  }

  return commands;
}

async function writeScopedCommands(cwd, lang, force, analysis = null) {
  const ext = lang === "python" ? "py" : lang === "go" ? "go" : "ts";

  const commands = [
    {
      file: "api-rules.md",
      paths: [`src/api/**/*.${ext}`, `app/api/**/*.${ext}`],
      content: `# API Rules
<!-- Loaded only when Claude edits API files — saves tokens elsewhere -->

- Validate all inputs at the route boundary
- Use the shared \`ApiError\` class for all error responses
- Every route needs an auth guard unless explicitly public
- Add integration tests for authorization failures
- Log request IDs for traceability
`,
    },
    {
      file: "test-rules.md",
      paths: [`**/*.test.${ext}`, `**/*.spec.${ext}`, `tests/**`],
      content: `# Test Rules
<!-- Loaded only when Claude edits test files -->

- Tests must be deterministic — no random seeds, no Date.now()
- Mock all external HTTP calls
- Each test file tests exactly one module
- Use \`describe\` / \`it\` blocks with clear names
- Always test the error path, not just the happy path
`,
    },
    {
      file: "ui-rules.md",
      paths: [`src/ui/**`, `src/components/**`, `app/**/*.tsx`],
      content: `# UI Rules
<!-- Loaded only when Claude edits UI files -->

- Components are functional only — no class components
- All user-facing strings go through i18n helpers
- Images must have alt text
- Interactive elements need keyboard support
- Never inline styles — use the design system tokens
`,
    },
    ...analysisScopedCommands(analysis, ext),
  ];

  for (const cmd of commands) {
    const dest = path.join(cwd, ".claude", "commands", cmd.file);
    if (!force && await fs.pathExists(dest)) continue;

    const frontmatter = `---
paths:\n${cmd.paths.map((p) => `  - "${p}"`).join("\n")}
---\n\n`;
    await fs.outputFile(dest, frontmatter + cmd.content);
  }
}

async function writeSubagentTemplates(cwd, force) {
  const templates = [
    {
      file: "explore.md",
      content: `# Subagent: Explore & Summarize
<!-- Use this when you need Claude to read many files without polluting main context -->
<!-- Model: Haiku (fast + cheap for exploration) -->

You are an exploration subagent. Your job is to read the files listed below and return ONLY a concise summary.

## Rules
- Return a summary of max 500 words
- Do NOT return raw file contents
- Highlight: key patterns, anti-patterns, TODOs, and any risks
- Format as bullet points

## Files to explore
<!-- List files or glob patterns here -->
- src/legacy/**/*.ts

## What to look for
<!-- Customize per task -->
- Deprecated API usage
- Unhandled promise rejections
- Missing input validation
`,
    },
    {
      file: "refactor.md",
      content: `# Subagent: Targeted Refactor
<!-- Use this to isolate a refactor task in its own context -->
<!-- Model: Sonnet (needs reasoning) -->

You are a refactor subagent. Apply the changes described below and return ONLY:
1. A list of files changed
2. A short summary of what changed and why
3. Any risks or follow-up tasks

## Task
<!-- Describe the refactor -->
Refactor the authentication module to use the new JWT helper.

## Constraints
- Do not change public API signatures
- All tests must pass after refactor
- Do not modify files outside src/auth/
`,
    },
  ];

  for (const tpl of templates) {
    const dest = path.join(cwd, ".claude", "subagents", tpl.file);
    if (!force && await fs.pathExists(dest)) continue;
    await fs.outputFile(dest, tpl.content);
  }
}
