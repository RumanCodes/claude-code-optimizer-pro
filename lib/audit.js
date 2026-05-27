import fs from "fs-extra";
import path from "path";
import chalk from "chalk";
import { loadConfig } from "./config.js";
import { estimateTokens } from "./token.js";

export async function collectAudit(cwd = process.cwd()) {
  const config = await loadConfig(cwd);
  const issues = [];
  const passes = [];

  // ── Check CLAUDE.md ──────────────────────────────────────
  const claudeMdPath = path.join(cwd, "CLAUDE.md");
  if (!(await fs.pathExists(claudeMdPath))) {
    issues.push("CLAUDE.md not found — create one with: cco init");
  } else {
    const content = await fs.readFile(claudeMdPath, "utf8");
    const lines = content.split("\n").length;
    const estimatedTokens = estimateTokens(content);

    if (lines > config.maxClaudeMdLines) {
      issues.push(
        `CLAUDE.md has ${lines} lines (limit: ${config.maxClaudeMdLines}). Trim it — every line costs tokens every session.`
      );
    } else {
      passes.push(`CLAUDE.md is ${lines} lines ✓ (under 200-line budget)`);
    }

    if (estimatedTokens > config.maxClaudeMdTokens) {
      issues.push(
        `CLAUDE.md is ~${estimatedTokens} tokens. Target under ${config.targetClaudeMdTokens} for best cache efficiency.`
      );
    } else {
      passes.push(`CLAUDE.md is ~${estimatedTokens} tokens ✓`);
    }

    // Check for common bloat patterns
    if (content.includes("node_modules")) {
      issues.push(
        'CLAUDE.md mentions "node_modules" — move this to .claudeignore instead'
      );
    }
    if ((content.match(/```/g) || []).length > 10) {
      issues.push(
        "CLAUDE.md has many code blocks — consider trimming examples to save tokens"
      );
    }
    if (content.length > 8000) {
      issues.push(
        "CLAUDE.md is very long. Consider splitting into path-scoped .claude/commands/ files"
      );
    }
  }

  // ── Check .claudeignore ──────────────────────────────────
  const ignorePath = path.join(cwd, ".claudeignore");
  if (!(await fs.pathExists(ignorePath))) {
    issues.push(
      ".claudeignore missing — Claude will read node_modules, dist, logs etc. Run: cco init"
    );
  } else {
    const ignore = await fs.readFile(ignorePath, "utf8");
    const critical = config.requiredIgnoreEntries;
    const missing = critical.filter((c) => !ignore.includes(c));
    if (missing.length > 0) {
      issues.push(`.claudeignore is missing critical entries: ${missing.join(", ")}`);
    } else {
      passes.push(".claudeignore has all critical entries ✓");
    }
  }

  // ── Check .claude/settings.json ─────────────────────────
  const settingsPath = path.join(cwd, ".claude", "settings.json");
  if (!(await fs.pathExists(settingsPath))) {
    issues.push(
      ".claude/settings.json missing — bash output is uncapped. Run: cco init"
    );
  } else {
    const settings = await fs.readJson(settingsPath);
    if (!settings.bash?.maxOutputLength) {
      issues.push(
        "settings.json: bash.maxOutputLength not set — long test logs will eat tokens"
      );
    } else if (settings.bash.maxOutputLength > 30000) {
      issues.push(
        `settings.json: bash.maxOutputLength is ${settings.bash.maxOutputLength} — recommended max is 20000`
      );
    } else {
      passes.push(
        `bash.maxOutputLength = ${settings.bash.maxOutputLength} ✓`
      );
    }
  }

  // ── Check path-scoped commands ───────────────────────────
  const commandsDir = path.join(cwd, ".claude", "commands");
  if (!(await fs.pathExists(commandsDir))) {
    issues.push(
      ".claude/commands/ not found — you're paying tokens for rules even when irrelevant. Run: cco init"
    );
  } else {
    const files = await fs.readdir(commandsDir);
    if (files.length === 0) {
      issues.push(".claude/commands/ is empty — add path-scoped rule files");
    } else {
      passes.push(`.claude/commands/ has ${files.length} scoped rule file(s) ✓`);
    }
  }

  return { cwd, issues, passes, config };
}

export function printAudit(result) {
  console.log(chalk.yellow("\n🔍 Auditing Claude Code config...\n"));

  if (result.passes.length > 0) {
    console.log(chalk.green("✅ Passing checks:"));
    result.passes.forEach((p) => console.log(chalk.green(`   • ${p}`)));
    console.log();
  }

  if (result.issues.length === 0) {
    console.log(
      chalk.bold.green("🎉 All checks passed! Your Claude Code config is optimized.\n")
    );
  } else {
    console.log(chalk.red(`⚠️  ${result.issues.length} issue(s) found:\n`));
    result.issues.forEach((issue, i) => {
      console.log(chalk.red(`   ${i + 1}. ${issue}`));
    });
    console.log(
      chalk.yellow(
        `\n   Fix all issues by running: ${chalk.bold("cco init --force")}\n`
      )
    );
  }
}

export async function audit(options = {}) {
  const result = await collectAudit();

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (options.markdown) {
    const { renderMarkdownReport } = await import("./reports.js");
    console.log(renderMarkdownReport(result));
  } else if (options.sarif) {
    const { renderSarifReport } = await import("./reports.js");
    console.log(JSON.stringify(renderSarifReport(result), null, 2));
  } else {
    printAudit(result);
  }

  if (options.ci && result.issues.length > 0) {
    process.exitCode = 1;
  }
}
