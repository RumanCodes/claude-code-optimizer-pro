#!/usr/bin/env node

import { program } from "commander";
import chalk from "chalk";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { init } from "../lib/init.js";
import { audit } from "../lib/audit.js";
import { stats } from "../lib/stats.js";
import { watch } from "../lib/watch.js";
import { doctor } from "../lib/doctor.js";
import { explain } from "../lib/explain.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../package.json"), "utf8")
);
const VERSION = pkg.version;

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
  .option("--force", "Overwrite existing files")
  .action(init);

program
  .command("audit")
  .description("Audit your existing CLAUDE.md and .claudeignore for issues")
  .option("--json", "Print machine-readable JSON")
  .option("--markdown", "Print a Markdown report")
  .option("--sarif", "Print a SARIF report")
  .option("--ci", "Exit with code 1 when issues are found")
  .action(audit);

program
  .command("doctor")
  .description("Diagnose Claude Code config and optionally apply safe fixes")
  .option("--fix", "Apply conservative fixes")
  .option("--json", "Print machine-readable JSON")
  .option("--ci", "Exit with code 1 when issues remain")
  .action(doctor);

program
  .command("stats")
  .description("Estimate token cost of your current CLAUDE.md")
  .action(stats);

program
  .command("watch")
  .description("Watch Claude Code config and report optimization issues in real time")
  .option("--once", "Run one optimizer snapshot and exit")
  .option("--debounce <ms>", "Debounce file changes in milliseconds", "300")
  .action(watch);

program
  .command("explain [topic]")
  .description("Explain Claude Code optimization concepts")
  .action(explain);

program.parse();
