import fs from "fs-extra";
import path from "path";
import chalk from "chalk";
import { loadConfig } from "./config.js";
import { estimateTokens } from "./token.js";

export async function collectStats(cwd = process.cwd()) {
  const config = await loadConfig(cwd);
  const claudeMdPath = path.join(cwd, "CLAUDE.md");

  if (!(await fs.pathExists(claudeMdPath))) {
    return {
      exists: false,
      path: claudeMdPath,
      lines: 0,
      chars: 0,
      tokens: 0,
      sections: [],
      dailyCost: 0,
      monthlyCost: 0,
    };
  }

  const content = await fs.readFile(claudeMdPath, "utf8");
  const lines = content.split("\n").length;
  const chars = content.length;
  const tokens = estimateTokens(content);

  // Cost estimates (Claude Sonnet pricing approx)
  const costPerMToken = 3.0; // $3 per million input tokens
  const sessionsPerDay = 10;
  const dailyCost = ((tokens * sessionsPerDay) / 1_000_000) * costPerMToken;
  const monthlyCost = dailyCost * 30;

  const sections = content.split(/^##\s+/m).filter(Boolean).map((section) => {
    const title = section.split("\n")[0].trim();
    const sectionTokens = estimateTokens(section);
    const pct = tokens === 0 ? 0 : Math.round((sectionTokens / tokens) * 100);
    return { title, tokens: sectionTokens, pct };
  });

  return {
    exists: true,
    path: claudeMdPath,
    lines,
    chars,
    tokens,
    sections,
    costPerMToken,
    sessionsPerDay,
    dailyCost,
    monthlyCost,
    config,
  };
}

export function printStats(result) {
  if (!result.exists) {
    console.log(chalk.red("\nNo CLAUDE.md found. Run: cco init\n"));
    return;
  }

  const bar = (val, max, width = 30) => {
    const filled = Math.min(Math.round((val / max) * width), width);
    const empty = width - filled;
    const color = val > max * 0.8 ? chalk.red : val > max * 0.5 ? chalk.yellow : chalk.green;
    return color("█".repeat(filled)) + chalk.gray("░".repeat(empty));
  };

  console.log(chalk.cyan("\n📊 CLAUDE.md Token Stats\n"));
  console.log(`  Lines:  ${bar(result.lines, result.config.maxClaudeMdLines)} ${result.lines}/${result.config.maxClaudeMdLines}`);
  console.log(`  Tokens: ${bar(result.tokens, result.config.maxClaudeMdTokens)} ~${result.tokens}/${result.config.maxClaudeMdTokens}\n`);

  console.log(chalk.bold("  Cost estimate (CLAUDE.md portion only):"));
  console.log(`  Per session:    ~${result.tokens.toLocaleString()} tokens`);
  console.log(
    `  Daily (${result.sessionsPerDay} sessions): ~$${result.dailyCost.toFixed(4)}`
  );
  console.log(`  Monthly:        ~$${result.monthlyCost.toFixed(3)}\n`);

  if (result.tokens > result.config.maxClaudeMdTokens) {
    console.log(
      chalk.red(
        "  ⚠️  CLAUDE.md is over the 2000-token target. Trim it or split into path-scoped commands.\n"
      )
    );
  } else if (result.tokens > result.config.targetClaudeMdTokens) {
    console.log(
      chalk.yellow("  ⚡ CLAUDE.md is getting large. Consider trimming.\n")
    );
  } else {
    console.log(chalk.green("  ✅ CLAUDE.md is lean and efficient!\n"));
  }

  // Section breakdown
  console.log(chalk.bold("  Section breakdown:"));
  result.sections.forEach((section) => {
    console.log(
      `  ${chalk.gray("##")} ${section.title.padEnd(30)} ~${section.tokens} tokens (${section.pct}%)`
    );
  });
  console.log();
}

export async function stats() {
  printStats(await collectStats());
}
