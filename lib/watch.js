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
    let stat;
    try {
      stat = await fsp.stat(fullPath);
    } catch {
      continue;
    }
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

function normalizePath(value) {
  return value.replace(/\\/g, "/");
}

function isRelevantChange(targetPath) {
  const normalized = normalizePath(targetPath);
  return WATCH_TARGETS.some((watchTarget) =>
    normalized === watchTarget || normalized.startsWith(`${watchTarget}/`)
  );
}

function buildCandidates(base, filename) {
  if (!filename) return [normalizePath(base)];
  return [normalizePath(path.join(base, filename)), normalizePath(base)];
}

function shouldReconcileDynamicWatches(targetPath) {
  return (
    targetPath === ".claude" ||
    targetPath.startsWith(".claude/") ||
    WATCH_TARGETS.includes(targetPath) ||
    targetPath.endsWith(".claude/settings.json") ||
    targetPath.endsWith(".claudeignore") ||
    targetPath.endsWith("CLAUDE.md")
  );
}

async function addDirectoryWatchers(cwd, watchers, onChange, basePath) {
  const fullPath = path.join(cwd, basePath);
  if (!(await pathExists(fullPath))) return;

  let stat;
  try {
    stat = await fsp.stat(fullPath);
  } catch {
    return;
  }
  if (!stat.isDirectory()) return;
  if (watchers.has(fullPath)) return;

  try {
    const watcher = fs.watch(fullPath, { persistent: true }, (eventType, filename) => {
      onChange({ target: fullPath, eventType, filename });
    });
    watcher.on("error", () => {
      watchers.delete(fullPath);
      try {
        watcher.close();
      } catch {
      }
    });
    watchers.set(fullPath, watcher);
  } catch {
    return;
  }
}

async function addFileWatch(cwd, watchers, onChange, relativePath) {
  const fullPath = path.join(cwd, relativePath);
  if (!(await pathExists(fullPath))) return;

  let stat;
  try {
    stat = await fsp.stat(fullPath);
  } catch {
    return;
  }
  if (!stat.isFile()) return;
  if (watchers.has(fullPath)) return;

  try {
    const watcher = fs.watch(fullPath, { persistent: true }, (eventType, filename) => {
      onChange({ target: fullPath, eventType, filename });
    });
    watcher.on("error", () => {
      watchers.delete(fullPath);
      try {
        watcher.close();
      } catch {
      }
    });
    watchers.set(fullPath, watcher);
  } catch {
    return;
  }
}

export async function watch(options = {}) {
  const cwd = process.cwd();
  const debounceMs = Number(options.debounce ?? 300);
  const watchers = new Map();

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

  const handleChange = async ({ target, eventType, filename }) => {
    const base = path.resolve(target);
    const candidates = buildCandidates(base, filename)
      .map((candidate) => normalizePath(path.relative(cwd, candidate)))
      .filter((candidate) => candidate && candidate !== "." && !candidate.startsWith(".."));

    for (const candidate of candidates) {
      if (shouldReconcileDynamicWatches(candidate)) {
        await addDirectoryWatchers(cwd, watchers, handleChange, ".claude");
        await addDirectoryWatchers(cwd, watchers, handleChange, ".claude/commands");
        await addDirectoryWatchers(cwd, watchers, handleChange, ".claude/subagents");
        await addFileWatch(cwd, watchers, handleChange, "CLAUDE.md");
        await addFileWatch(cwd, watchers, handleChange, ".claudeignore");
        await addFileWatch(cwd, watchers, handleChange, ".claude/settings.json");
      }

      if (isRelevantChange(candidate)) {
        schedule();
        break;
      }
    }
  };

  const rootWatcher = fs.watch(cwd, { persistent: true }, (eventType, filename) => {
    handleChange({ target: cwd, eventType, filename }).catch(() => {});
  });
  rootWatcher.on("error", () => {
    watchers.delete(cwd);
    try {
      rootWatcher.close();
    } catch {
    }
  });
  watchers.set(cwd, rootWatcher);

  await addDirectoryWatchers(cwd, watchers, handleChange, ".claude");
  await addDirectoryWatchers(cwd, watchers, handleChange, ".claude/commands");
  await addDirectoryWatchers(cwd, watchers, handleChange, ".claude/subagents");
  await addFileWatch(cwd, watchers, handleChange, "CLAUDE.md");
  await addFileWatch(cwd, watchers, handleChange, ".claudeignore");
  await addFileWatch(cwd, watchers, handleChange, ".claude/settings.json");

  if (watchers.size === 1) {
    console.log(chalk.yellow("No Claude optimizer files found yet. Run: cco init"));
  }

  return Array.from(watchers.values());
}
