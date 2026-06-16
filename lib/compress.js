import fs from "fs-extra";
import path from "path";
import chalk from "chalk";
import readline from "node:readline";
import { estimateTokens } from "./token.js";

const CODE_LANG_MAP = {
  javascript: "js",
  typescript: "ts",
  python: "py",
  go: "go",
  ruby: "rb",
  shell: "sh",
  bash: "sh",
  dockerfile: "docker",
};

export function removeExtraBlankLines(content) {
  return content.replace(/\n{3,}/g, "\n\n");
}

export function shortenCodeFences(content) {
  return content.replace(
    /^(```)(javascript|typescript|python|ruby|golang|shell|bash|dockerfile)$/gm,
    (_, fence, lang) => fence + (CODE_LANG_MAP[lang] ?? lang),
  );
}

export function truncateLongLists(content, maxItems = 5) {
  const changes = [];
  const output = content.replace(
    /((?:^[ \t]*[-*] .+\n){6,})/gm,
    (match) => {
      const rows = match.split("\n").filter(Boolean);
      if (rows.length <= maxItems) return match;
      const kept = rows.slice(0, maxItems);
      const dropped = rows.length - maxItems;
      changes.push(`Shortened bullet list (kept ${maxItems} of ${rows.length} items)`);
      return `${kept.join("\n")}\n- # ... ${dropped} more\n`;
    },
  );

  return { result: output, changes };
}

export function computeTokenStats(original, compressed) {
  const beforeTokens = estimateTokens(original);
  const afterTokens = estimateTokens(compressed);
  const saved = beforeTokens - afterTokens;
  const percent = beforeTokens > 0 ? Math.round((saved / beforeTokens) * 100) : 0;
  return { beforeTokens, afterTokens, saved, percent };
}

export function applyCompressionRules(content, aggressive = false) {
  const changes = [];
  let result = content;

  const fenceCount = (result.match(/^```(javascript|typescript|python|ruby|golang|shell|bash|dockerfile)$/gm) || []).length;
  result = shortenCodeFences(result);
  if (fenceCount > 0) {
    changes.push(`Shortened ${fenceCount} code-fence language tags`);
  }

  const beforeBlankGroups = (result.match(/\n{3,}/g) || []).length;
  result = removeExtraBlankLines(result);
  if (beforeBlankGroups > 0) {
    changes.push(`Removed ${beforeBlankGroups} excessive blank-line block${beforeBlankGroups > 1 ? "s" : ""}`);
  }

  const listLimit = aggressive ? 3 : 5;
  const listResult = truncateLongLists(result, listLimit);
  result = listResult.result;
  changes.push(...listResult.changes);

  return { result, changes };
}

async function promptApply() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => rl.question(chalk.blue("Apply changes? [y/N] "), resolve));
  rl.close();
  return String(answer).trim().toLowerCase() === "y";
}

function maybeWriteFile(filePath, original, compressed, backup = true, stats) {
  if (backup !== false) {
    fs.writeFileSync(`${filePath}.bak`, original, "utf8");
    console.log(chalk.dim("  Backup: CLAUDE.md.bak"));
  }
  fs.writeFileSync(filePath, compressed, "utf8");
  console.log(chalk.green(`✓ Saved — ${stats.saved} tokens freed (${stats.percent}% reduction)`));
}

function printReport(stats, changes) {
  console.log(chalk.bold("\ncco compress — CLAUDE.md optimization"));
  console.log("");
  console.log(`  Before: ${chalk.yellow(stats.beforeTokens)} tokens`);
  console.log(`  After:  ${chalk.green(stats.afterTokens)} tokens (${stats.percent}% reduction)`);
  console.log("");
  if (changes.length === 0) {
    console.log(chalk.dim("  No compression opportunities found."));
    console.log("");
    return;
  }
  console.log("  Changes:");
  for (const change of changes) {
    console.log(`  - ${change}`);
  }
  console.log("");
}

export async function compress(options = {}) {
  const claudePath = path.join(process.cwd(), "CLAUDE.md");
  if (!(await fs.pathExists(claudePath))) {
    console.error(chalk.red("✗ CLAUDE.md not found. Run: cco init"));
    process.exitCode = 1;
    return;
  }

  const original = await fs.readFile(claudePath, "utf8");
  const { result: compressed, changes } = applyCompressionRules(original, !!options.aggressive);
  const stats = computeTokenStats(original, compressed);

  printReport(stats, changes);

  if (options.dryRun) {
    console.log(chalk.dim("  --dry-run: no files written."));
    console.log("");
    return;
  }
  if (original === compressed || changes.length === 0) {
    console.log(chalk.dim("  Content unchanged after compression."));
    console.log("");
    return;
  }

  if (!(await promptApply())) {
    console.log(chalk.dim("  Skipped."));
    console.log("");
    return;
  }

  maybeWriteFile(claudePath, original, compressed, options.backup, stats);
  console.log("");
}

