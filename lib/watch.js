import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import chalk from "chalk";
import { collectAudit } from "./audit.js";
import { collectStats } from "./stats.js";
import { loadConfig } from "./config.js";

const WATCH_TARGETS = [
  "CLAUDE.md",
  ".claudeignore",
  ".claude/settings.json",
  ".claude/commands",
  ".claude/subagents",
];

function statusColor(issueCount, tokens) {
  if (issueCount > 0 || tokens > 2000) return chalk.red;
  if (tokens > 1000) return chalk.yellow;
  return chalk.green;
}

function renderIssues(issues) {
  if (issues.length === 0) return chalk.green("No audit issues");
  return issues.slice(0, 5).map((issue, index) => {
    return chalk.red(`  ${index + 1}. ${issue}`);
  }).join("\n");
}

async function collectWatchRisks(cwd, config) {
  const risks = [];
  const riskyPaths = [".env", ".env.local", "dist", "build", "coverage", "node_modules"];

  for (const relativePath of riskyPaths) {
    const fullPath = path.join(cwd, relativePath);
    if (await pathExists(fullPath)) {
      risks.push(`${relativePath} exists; confirm it is covered by .claudeignore`);
    }
  }

  const entries = await fsp.readdir(cwd, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const fullPath = path.join(cwd, entry.name);
    const stat = await fsp.stat(fullPath);
    if (stat.size > config.maxLargeFileBytes) {
      risks.push(`${entry.name} is ${(stat.size / 1024).toFixed(0)}KB; consider ignoring large generated/data files`);
    }
  }

  return risks.slice(0, 6);
}

export async function runWatchSnapshot(cwd = process.cwd()) {
  const config = await loadConfig(cwd);
  const [audit, stats, risks] = await Promise.all([
    collectAudit(cwd),
    collectStats(cwd),
    collectWatchRisks(cwd, config),
  ]);

  const color = statusColor(audit.issues.length, stats.tokens);
  const timestamp = new Date().toLocaleTimeString();
  const tokenLabel = stats.exists ? `~${stats.tokens} tokens` : "missing CLAUDE.md";

  console.log(chalk.cyan(`\n[${timestamp}] Claude Code optimizer snapshot`));
  console.log(color(`  CLAUDE.md: ${tokenLabel}`));
  console.log(color(`  Audit: ${audit.issues.length} issue(s), ${audit.passes.length} passing check(s)`));
  console.log(renderIssues(audit.issues));
  if (risks.length > 0) {
    console.log(chalk.yellow("  Watch risks:"));
    risks.forEach((risk) => console.log(chalk.yellow(`  - ${risk}`)));
  }

  if (stats.exists && stats.tokens > config.targetClaudeMdTokens) {
    console.log(chalk.yellow("  Suggestion: move rarely used guidance into .claude/commands/ path-scoped files."));
  }

  return { audit, stats, risks };
}

async function pathExists(target) {
  try {
    await fsp.access(target);
    return true;
  } catch {
    return false;
  }
}

async function watchPath(target, onChange) {
  if (!(await pathExists(target))) return null;

  return fs.watch(target, { persistent: true }, (eventType, filename) => {
    onChange({ target, eventType, filename });
  });
}

export async function watch(options = {}) {
  const cwd = process.cwd();
  const debounceMs = Number(options.debounce ?? 300);

  if (options.once) {
    await runWatchSnapshot(cwd);
    return [];
  }

  console.log(chalk.cyan("\nWatching Claude Code optimizer files. Press Ctrl+C to stop."));
  await runWatchSnapshot(cwd);

  let timer = null;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      runWatchSnapshot(cwd).catch((err) => {
        console.error(chalk.red(`Watch check failed: ${err.message}`));
      });
    }, debounceMs);
  };

  const watchers = [];
  for (const relativeTarget of WATCH_TARGETS) {
    const watcher = await watchPath(path.join(cwd, relativeTarget), schedule);
    if (watcher) watchers.push(watcher);
  }

  if (watchers.length === 0) {
    console.log(chalk.yellow("No Claude optimizer files found yet. Run: cco init"));
  }

  return watchers;
}
