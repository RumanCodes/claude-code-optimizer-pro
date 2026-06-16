import fs from "fs-extra";
import path from "path";
import chalk from "chalk";
import { estimateTokens } from "./token.js";

function computeDiff(currentContent, backupContent) {
  const currentTokens = estimateTokens(currentContent);
  const backupTokens = estimateTokens(backupContent);
  const tokenDelta = currentTokens - backupTokens;
  const tokenPct = backupTokens > 0 ? Math.round((Math.abs(tokenDelta) / backupTokens) * 100) : 0;
  const currentLines = currentContent.split("\n").length;
  const backupLines = backupContent.split("\n").length;
  const lineDelta = currentLines - backupLines;

  return {
    currentTokens,
    backupTokens,
    tokenDelta,
    tokenPct,
    currentLines,
    backupLines,
    lineDelta,
  };
}

function printDiffReport(targetLabel, backupLabel, diffData) {
  const sep = "─".repeat(45);
  console.log("");
  console.log(chalk.bold(`📊 Token diff — ${targetLabel}`));
  console.log("");
  console.log(chalk.dim(`  ${sep}`));
  console.log(
    `  ${`Before (${backupLabel}):`.padEnd(36)} ${chalk.yellow(String(diffData.backupTokens).padStart(6))} tokens`,
  );
  console.log(
    `  ${`After (${targetLabel}):`.padEnd(36)} ${chalk.cyan(String(diffData.currentTokens).padStart(6))} tokens`,
  );
  console.log(chalk.dim(`  ${sep}`));

  if (diffData.tokenDelta < 0) {
    const saved = Math.abs(diffData.tokenDelta);
    console.log(`  ${"Saved:".padEnd(36)} ${chalk.green(String(saved).padStart(6))} tokens  ${chalk.green(`(-${diffData.tokenPct}%)`)}`);
  } else if (diffData.tokenDelta > 0) {
    console.log(`  ${"Added:".padEnd(36)} ${chalk.red("+" + String(diffData.tokenDelta).padStart(5))} tokens  ${chalk.red(`(+${diffData.tokenPct}%)`)}`);
  } else {
    console.log(`  ${chalk.dim("No token change.")}`);
  }

  const lineSign = diffData.lineDelta > 0 ? "+" : "";
  const lineColor = diffData.lineDelta < 0 ? chalk.green : diffData.lineDelta > 0 ? chalk.red : chalk.dim;
  console.log("");
  console.log(`  Line diff: ${lineColor(lineSign + diffData.lineDelta + " lines")}  (${diffData.backupLines} → ${diffData.currentLines})`);
  console.log("");
}

export async function diff(options = {}) {
  const cwd = process.cwd();
  const targetFile = options.file || "CLAUDE.md";
  const targetPath = path.isAbsolute(targetFile) ? targetFile : path.join(cwd, targetFile);
  const backupPath = `${targetPath}.bak`;

  if (!(await fs.pathExists(backupPath))) {
    console.log("");
    console.log(chalk.yellow(`  No ${path.basename(backupPath)} found.`));
    console.log(`  Run ${chalk.cyan("cco compress")} or ${chalk.cyan("cco prune")} first (both create a .bak).`);
    console.log("");
    return;
  }

  if (!(await fs.pathExists(targetPath))) {
    console.log(chalk.red(`  Error: ${targetFile} not found.`));
    return;
  }

  const targetContent = await fs.readFile(targetPath, "utf8");
  const backupContent = await fs.readFile(backupPath, "utf8");
  const report = computeDiff(targetContent, backupContent);
  printDiffReport(path.relative(cwd, targetPath), path.relative(cwd, backupPath), report);
}

