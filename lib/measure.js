import fs from "fs-extra";
import path from "path";
import chalk from "chalk";
import { estimateTokens } from "./token.js";
import { parseIgnoreContent, normalizeIgnoreLine } from "./ignore-utils.js";
import { loadConfig } from "./config.js";

const AUTO_LOAD_DIRS = [".claude", "docs"];
const AUTO_LOAD_ROOT_EXT = new Set([".md", ".txt"]);
const LARGE_FILE_LIMIT = 300_000;

function toPosix(filePath) {
  return filePath.replace(/\\/g, "/");
}

function normalizePattern(pattern) {
  if (!pattern) return "";
  return normalizeIgnoreLine(pattern).replace(/\/+$/, "");
}

function patternToRegex(pattern) {
  const normalized = normalizePattern(pattern);
  if (!normalized.includes("*")) {
    return new RegExp(`^${normalized.split("/").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("/")}(/.*)?$`);
  }

  const escaped = normalized
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${escaped}$`);
}

function isIgnored(relativePath, patterns) {
  const normalized = toPosix(relativePath);
  for (const raw of patterns) {
    const pattern = normalizePattern(raw);
    if (!pattern) continue;
    if (pattern.startsWith("/")) {
      if (normalized === pattern.slice(1) || normalized.startsWith(pattern.slice(1) + "/")) return true;
      continue;
    }

    if (pattern.endsWith("/**")) {
      const base = pattern.slice(0, -3);
      if (normalized === base || normalized.startsWith(`${base}/`)) return true;
      continue;
    }

    if (pattern.endsWith("/")) {
      const base = pattern.slice(0, -1);
      if (normalized === base || normalized.startsWith(`${base}/`)) return true;
      continue;
    }

    if (pattern.includes("*")) {
      const regex = patternToRegex(pattern);
      if (regex.test(normalized)) return true;
      continue;
    }

    if (normalized === pattern || normalized.endsWith(`/${pattern}`) || normalized.startsWith(`${pattern}/`)) {
      return true;
    }
  }
  return false;
}

async function scanMarkdownFiles(cwd, baseDir, patterns, files) {
  const base = path.join(cwd, baseDir);
  if (!(await fs.pathExists(base))) return;

  const dirEntries = await fs.readdir(base, { withFileTypes: true });
  for (const entry of dirEntries) {
    const absolute = path.join(base, entry.name);
    const relative = toPosix(path.relative(cwd, absolute));

    if (isIgnored(relative, patterns)) continue;
    if (entry.isDirectory()) {
      await scanMarkdownFiles(cwd, relative, patterns, files);
      continue;
    }
    if (!entry.isFile()) continue;
    if (path.extname(entry.name).toLowerCase() !== ".md") continue;

    const stat = await fs.stat(absolute);
    if (stat.size > LARGE_FILE_LIMIT) continue;
    if (!await fs.pathExists(absolute)) continue;

    const content = await fs.readFile(absolute, "utf8");
    files.push({
      path: relative,
      tokens: estimateTokens(content),
      bytes: stat.size,
      lines: content.split("\n").length,
    });
  }
}

async function collectAutoLoadFiles(cwd) {
  const ignorePath = path.join(cwd, ".claudeignore");
  const ignorePatterns = (await fs.pathExists(ignorePath))
    ? parseIgnoreContent(await fs.readFile(ignorePath, "utf8"))
    : [];

  const files = [];
  const rootEntries = await fs.readdir(cwd, { withFileTypes: true });
  for (const entry of rootEntries) {
    const full = path.join(cwd, entry.name);
    const relative = entry.name;
    if (!entry.isFile()) continue;
    if (!AUTO_LOAD_ROOT_EXT.has(path.extname(entry.name).toLowerCase())) continue;
    if (entry.name === ".DS_Store" || entry.name === ".claudeignore" || entry.name === "package-lock.json") continue;
    if (isIgnored(relative, ignorePatterns)) continue;

    const stat = await fs.stat(full);
    if (stat.size > LARGE_FILE_LIMIT) continue;
    const content = await fs.readFile(full, "utf8");
    files.push({
      path: relative,
      tokens: estimateTokens(content),
      bytes: stat.size,
      lines: content.split("\n").length,
    });
  }

  for (const dir of AUTO_LOAD_DIRS) {
    await scanMarkdownFiles(cwd, dir, ignorePatterns, files);
  }

  return files
    .filter((item) => !isIgnored(item.path, ignorePatterns))
    .sort((a, b) => b.tokens - a.tokens || a.path.localeCompare(b.path));
}

function buildMeasureReport(files, initialized, config) {
  const before = files.reduce((sum, item) => sum + item.tokens, 0);
  const target = config.maxClaudeMdTokens;
  const postTarget = initialized ? target : Math.max(config.targetClaudeMdTokens, 400);
  const estimatedAfter = initialized ? Math.min(before, target) : Math.min(before, postTarget);
  const savings = before - estimatedAfter;
  const lines = [];

  lines.push(chalk.bold("\n📊 Token measure report"));
  lines.push("");
  if (files.length === 0) {
    lines.push(chalk.dim("No markdown files detected as auto-loaded context."));
    lines.push(chalk.dim("Run cco init to set up optimizer files."));
    return lines;
  }

  lines.push(chalk.dim("Auto-loaded file candidates"));
  lines.push(chalk.dim("  " + "─".repeat(57)));
  files.forEach((file) => {
    const label = file.path.padEnd(42);
    lines.push(`  ${label} ${String(file.tokens).padStart(7)} tokens`);
  });
  lines.push(chalk.dim("  " + "─".repeat(57)));
  lines.push(`  TOTAL AUTO-LOADED: ${chalk.yellow(before.toLocaleString())} tokens`);
  lines.push("");

  if (before > target) {
    lines.push(chalk.yellow(`Baseline target: ${target.toLocaleString()} tokens (${target} from .cco config)`));
  } else if (initialized) {
    lines.push(chalk.green("Token load is already within budget."));
  }

  if (initialized) {
    if (before > target) {
      lines.push(chalk.yellow(`Estimated immediate gain by tightening scope: ~${Math.max(savings, 0).toLocaleString()} tokens`));
      lines.push(chalk.dim("Action: run cco compress"));
    } else {
      lines.push(chalk.green("CLAUDE.md + docs are within configured token budget."));
    }
  } else {
    lines.push(chalk.green(`Estimated post-init target: ~${estimatedAfter.toLocaleString()} tokens`));
    lines.push(`Potential savings: ${chalk.green(Math.max(savings, 0).toLocaleString())} tokens`);
    lines.push(chalk.dim("Action: run cco init"));
  }

  return lines;
}

export async function measure() {
  const cwd = process.cwd();
  const config = await loadConfig(cwd);
  const files = await collectAutoLoadFiles(cwd);
  const claudePath = path.join(cwd, "CLAUDE.md");
  const initialized = await fs.pathExists(claudePath);
  const reportLines = buildMeasureReport(files, initialized, config);
  for (const line of reportLines) console.log(line);
  console.log("");
}
