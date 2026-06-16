import fs from "fs-extra";
import path from "path";
import chalk from "chalk";
import readline from "node:readline";
import { estimateTokens } from "./token.js";

function promptUser(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => {
    rl.close();
    resolve(answer);
  }));
}

export function parseSections(content) {
  const lines = content.split("\n");
  const sections = [];
  let current = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (match) {
      if (current) sections.push(current);
      current = { heading: match[2], level: match[1].length, raw: line, content: "", startLine: i + 1 };
      continue;
    }
    if (current) {
      current.content = current.content ? `${current.content}\n${line}` : line;
    }
  }

  if (current) sections.push(current);
  return sections;
}

function classifyCompletedSection(section) {
  if (!/^(completed|done|✓)/i.test(section.heading.trim())) return null;
  const text = `${section.raw}\n${section.content}`;
  return {
    heading: section.heading,
    content: text,
    tokens: estimateTokens(text),
    startLine: section.startLine,
    destination: "completions",
  };
}

function classifySessionSection(section) {
  if (!/^\d{4}-\d{2}-\d{2}/.test(section.heading.trim())) return null;
  const text = `${section.raw}\n${section.content}`;
  return {
    heading: section.heading,
    content: text,
    tokens: estimateTokens(text),
    startLine: section.startLine,
    destination: "sessions/archive",
  };
}

function classifyEmptySection(section, nextSection) {
  if (section.level < 2) return null;
  const hasChildren = nextSection && nextSection.level > section.level;
  if (section.content.trim() || hasChildren) return null;
  return {
    heading: section.heading,
    content: `${section.raw}`,
    tokens: 0,
    startLine: section.startLine,
    destination: null,
  };
}

export function findPruneTargets(content) {
  const sections = parseSections(content);
  const targets = [];

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const next = sections[i + 1];
    const target =
      classifyCompletedSection(section) ||
      classifySessionSection(section) ||
      classifyEmptySection(section, next);
    if (target) targets.push(target);
  }

  return targets;
}

export function removeSection(content, sectionRawLine) {
  const level = (sectionRawLine.match(/^(#+)/) || ["", "#"])[1].length;
  const escaped = sectionRawLine.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `${escaped}[\\s\\S]*?(?=\\n#{1,${level}}\\s|$)`,
    "m",
  );
  return content.replace(pattern, "").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

export function applyPruneTargets(content, targets) {
  let result = content;
  let totalSaved = 0;
  for (const target of targets) {
    result = removeSection(result, target.content.split("\n")[0]);
    totalSaved += target.tokens;
  }
  return { result: result || "", totalSaved };
}

export function buildArchiveFileName(date, heading) {
  const slug = heading.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${date}-pruned-${slug}.md`;
}

export function buildArchiveContent(date, content) {
  return `# Pruned from CLAUDE.md on ${date}\n\n${content}\n`;
}

function writeArchive(dir, target, date) {
  const archiveDir = path.join(dir, ".claude", target.destination);
  fs.mkdirSync(archiveDir, { recursive: true });
  const archivePath = path.join(archiveDir, buildArchiveFileName(date, target.heading));
  fs.writeFileSync(archivePath, buildArchiveContent(date, target.content), "utf8");
  return archivePath;
}

function printTarget(target, index) {
  const dest = target.destination ? `→ archive to .claude/${target.destination}/` : "→ delete";
  console.log(`  [${index + 1}] "${target.heading}" (line ${target.startLine}, ${target.tokens} tokens)`);
  console.log(`      ${chalk.dim(dest)}`);
}

async function collectAcceptedTargets(targets, options) {
  if (options.yes) {
    targets.forEach((target, idx) => printTarget(target, idx));
    return targets;
  }

  const approved = [];
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  for (let i = 0; i < targets.length; i++) {
    printTarget(targets[i], i);
    const answer = await new Promise((resolve) => rl.question(chalk.blue("      Apply? [Y/n] "), resolve));
    if (String(answer).trim().toLowerCase() !== "n") {
      approved.push(targets[i]);
    }
  }
  rl.close();
  return approved;
}

export async function prune(options = {}) {
  const dir = process.cwd();
  const claudePath = path.join(dir, "CLAUDE.md");
  if (!(await fs.pathExists(claudePath))) {
    console.error(chalk.red("✗ CLAUDE.md not found. Run: cco init"));
    process.exitCode = 1;
    return;
  }

  console.log(chalk.bold("\ncco prune — scanning CLAUDE.md"));
  const original = await fs.readFile(claudePath, "utf8");
  const targets = findPruneTargets(original);
  if (targets.length === 0) {
    console.log(chalk.green("  Nothing to prune. CLAUDE.md looks clean."));
    console.log("");
    return;
  }

  if (options.dryRun) {
    console.log("");
    console.log(`Found ${targets.length} item${targets.length > 1 ? "s" : ""} to prune:\n`);
    for (let i = 0; i < targets.length; i++) {
      printTarget(targets[i], i);
    }
    console.log("");
    console.log(chalk.dim("  --dry-run: no files written."));
    console.log("");
    return;
  }

  const accepted = await collectAcceptedTargets(targets, options);
  if (accepted.length === 0) {
    console.log(chalk.dim("No changes applied."));
    console.log("");
    return;
  }

  if (options.backup !== false) {
    await fs.writeFile(`${claudePath}.bak`, original);
  }

  const date = new Date().toISOString().split("T")[0];
  for (const target of accepted) {
    if (target.destination) {
      const archivePath = writeArchive(dir, target, date);
      console.log(chalk.dim(`      Archived → ${path.relative(dir, archivePath)}`));
    }
  }

  const { result, totalSaved } = applyPruneTargets(original, accepted);
  await fs.writeFile(claudePath, result, "utf8");
  const beforeTokens = estimateTokens(original);
  const afterTokens = estimateTokens(result);
  console.log(chalk.green(`✓ Saved ${totalSaved} tokens — CLAUDE.md now ${afterTokens} tokens (was ${beforeTokens})`));
  console.log("");
}
