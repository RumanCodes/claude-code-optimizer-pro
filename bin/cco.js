#!/usr/bin/env node

import { program } from "commander";
import chalk from "chalk";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { init } from "../lib/init.js";
import { audit } from "../lib/audit.js";
import { stats } from "../lib/stats.js";
import { measure } from "../lib/measure.js";
import { watch } from "../lib/watch.js";
import { doctor } from "../lib/doctor.js";
import { explain } from "../lib/explain.js";
import { analyze } from "../lib/analyze.js";
import { scanRepository } from "../lib/scanner.js";
import { compress } from "../lib/compress.js";
import { prune } from "../lib/prune.js";
import { diff } from "../lib/diff.js";
import { hooksCommand } from "../lib/hooks.js";
import { update } from "../lib/update.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../package.json"), "utf8")
);
const VERSION = pkg.version;

function handleError(error) {
  const message = error?.message || String(error);
  console.error(chalk.red(`cco command failed: ${message}`));
  process.exitCode = 1;
}

function safeAction(action) {
  return async (...args) => {
    try {
      return await action(...args);
    } catch (error) {
      handleError(error);
    }
  };
}

const silentBannerFlags = ["--json", "--sarif", "--markdown"];
if (!silentBannerFlags.some((flag) => process.argv.includes(flag))) {
  console.log(
    chalk.cyan(`
  ╔═══════════════════════════════════╗
  ║ claude-code-optimizer-pro v${VERSION}  ║
  ║   Save tokens. Ship faster.       ║
  ╚═══════════════════════════════════╝
`)
  );
}

program
  .name("cco")
  .description("Optimize Claude Code for token savings and speed")
  .version(VERSION);

program
  .command("init")
  .description("Scaffold all optimizer files into the current project")
  .option("--lang <language>", "Project language (auto|js|ts|python|go)", "auto")
  .option("--framework <name>", "Framework (auto|next|react|express|fastapi|none)", "auto")
  .option("--preset <name>", "Preset (auto|next|react|express|fastapi|npm-package|monorepo)", "auto")
  .option("--monorepo", "Force monorepo-oriented guidance")
  .option("--analyze", "Analyze repository files before generating Claude Code guidance")
  .option("--review", "Review detected context before writing files")
  .option("--force", "Overwrite existing files")
  .action(safeAction(init));

program
  .command("scan")
  .description("Safely scan and classify repository files")
  .option("--json", "Print machine-readable JSON")
  .option("--max-files <n>", "Maximum files to classify", "400")
  .action(safeAction(async (options) => {
    const result = await scanRepository(process.cwd(), options);
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`Scanned ${result.files.length} file(s).`);
      for (const [role, files] of Object.entries(result.byRole)) {
        console.log(`${role}: ${files.length}`);
      }
    }
  }));

program
  .command("analyze")
  .description("Analyze the repository and report Claude Code project facts")
  .option("--json", "Print machine-readable JSON")
  .option("--max-files <n>", "Maximum source files to inspect", "80")
  .option("--sample-files <n>", "Maximum source files to read for patterns", "30")
  .option("--cache", "Write .cco/cache/analysis.json")
  .action(safeAction(analyze));

program
  .command("audit")
  .description("Audit your existing CLAUDE.md and .claudeignore for issues")
  .option("--json", "Print machine-readable JSON")
  .option("--markdown", "Print a Markdown report")
  .option("--sarif", "Print a SARIF report")
  .option("--ci", "Exit with code 1 when issues are found")
  .action(safeAction(audit));

program
  .command("doctor")
  .description("Diagnose Claude Code config and optionally apply safe fixes")
  .option("--fix", "Apply conservative fixes")
  .option("--json", "Print machine-readable JSON")
  .option("--ci", "Exit with code 1 when issues remain")
  .action(safeAction(doctor));

program
  .command("stats")
  .description("Estimate token cost of your current CLAUDE.md")
  .action(safeAction(stats));

program
  .command("measure")
  .description("Measure current auto-loaded token load and optimization impact")
  .action(safeAction(measure));

program
  .command("watch")
  .description("Watch Claude Code config and report optimization issues in real time")
  .option("--once", "Run one optimizer snapshot and exit")
  .option("--debounce <ms>", "Debounce file changes in milliseconds", "300")
  .action(safeAction(watch));

program
  .command("explain [topic]")
  .description("Explain Claude Code optimization concepts")
  .action(safeAction(explain));

program
  .command("compress")
  .description("Compress CLAUDE.md with conservative token-reduction rules")
  .option("--dry-run", "Show changes without writing")
  .option("--aggressive", "Apply more aggressive list truncation")
  .option("--backup", "Create CLAUDE.md.bak before editing", true)
  .option("--no-backup", "Skip CLAUDE.md.bak backup")
  .action(safeAction(compress));

program
  .command("prune")
  .description("Prune completed/session/empty sections from CLAUDE.md")
  .option("--yes", "Auto-approve all prune candidates")
  .option("--dry-run", "Show what would be pruned without writing")
  .option("--backup", "Create CLAUDE.md.bak before editing", true)
  .option("--no-backup", "Skip CLAUDE.md.bak backup")
  .action(safeAction(prune));

program
  .command("diff")
  .description("Show token diff against .bak backup")
  .option("--file <path>", "Target file (default CLAUDE.md)", "CLAUDE.md")
  .action(safeAction(diff));

const hooks = program
  .command("hooks")
  .description("Manage Claude Code hook templates");

hooks
  .command("list")
  .description("List available hook templates and installed state")
  .action(safeAction(() => hooksCommand("list")));

hooks
  .command("install [name]")
  .description("Install hook template by name, or use --all")
  .option("-a, --all", "Install all hook templates")
  .action(safeAction((name, options) => hooksCommand("install", name, options)));

hooks
  .command("remove <name>")
  .description("Remove an installed hook")
  .option("-y, --yes", "Skip remove confirmation")
  .action(safeAction((name, options) => hooksCommand("remove", name, options)));

hooks
  .command("status")
  .description("Show installed hooks")
  .action(safeAction(() => hooksCommand("status")));

hooks
  .command("settings")
  .description("Print settings.json hooks block for installed hooks")
  .action(safeAction(() => hooksCommand("settings")));

program
  .command("update")
  .description("Update cco or refresh project content")
  .option("--content", "Refresh project template files in-place")
  .action(safeAction(update));

program.parse();
