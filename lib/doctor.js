import fs from "fs-extra";
import path from "path";
import chalk from "chalk";
import { collectAudit, printAudit } from "./audit.js";
import { init } from "./init.js";
import { detectProject } from "./detect.js";
import { writeDefaultConfig } from "./config.js";

const CRITICAL_IGNORE_ENTRIES = ["node_modules/", "dist/", ".git/", "*.log", ".env"];

async function appendMissingIgnoreEntries(cwd) {
  const ignorePath = path.join(cwd, ".claudeignore");
  if (!(await fs.pathExists(ignorePath))) return [];

  const content = await fs.readFile(ignorePath, "utf8");
  const missing = CRITICAL_IGNORE_ENTRIES.filter((entry) => {
    const normalized = entry.replace(/\/$/, "");
    return !content.includes(entry) && !content.includes(normalized);
  });

  if (missing.length === 0) return [];

  const addition = [
    "",
    "# Added by claude-code-optimizer-pro doctor",
    ...missing,
    "",
  ].join("\n");

  await fs.appendFile(ignorePath, addition);
  return missing.map((entry) => `Added .claudeignore entry: ${entry}`);
}

async function fixSettings(cwd) {
  const settingsPath = path.join(cwd, ".claude", "settings.json");
  let settings = {};

  if (await fs.pathExists(settingsPath)) {
    try {
      settings = await fs.readJson(settingsPath);
    } catch {
      settings = {};
    }
  }

  settings.bash = settings.bash || {};
  const changes = [];

  if (!settings.bash.maxOutputLength || settings.bash.maxOutputLength > 30000) {
    settings.bash.maxOutputLength = 20000;
    changes.push("Set bash.maxOutputLength to 20000");
  }

  if (changes.length > 0) {
    await fs.outputJson(settingsPath, settings, { spaces: 2 });
  }

  return changes;
}

async function cleanClaudeMd(cwd) {
  const claudePath = path.join(cwd, "CLAUDE.md");
  if (!(await fs.pathExists(claudePath))) return [];

  const content = await fs.readFile(claudePath, "utf8");
  const next = content
    .replace(/Don't read `node_modules\/` — it's in \.claudeignore/g, "Don't read dependency directories — they're in .claudeignore")
    .replace(/mentions? "node_modules"/g, "mentions dependency directories");

  if (next === content) return [];

  await fs.writeFile(claudePath, next);
  return ["Cleaned generated node_modules guidance from CLAUDE.md"];
}

async function fixNpmPackagePublishList(cwd) {
  const packagePath = path.join(cwd, "package.json");
  if (!(await fs.pathExists(packagePath))) return [];

  const pkg = await fs.readJson(packagePath);
  if (pkg.private || pkg.files) return [];

  const files = [];
  if (await fs.pathExists(path.join(cwd, "bin"))) files.push("bin");
  if (await fs.pathExists(path.join(cwd, "lib"))) files.push("lib");
  if (await fs.pathExists(path.join(cwd, "src"))) files.push("src");
  if (await fs.pathExists(path.join(cwd, "README.md"))) files.push("README.md");
  if (await fs.pathExists(path.join(cwd, "SPEC.md"))) files.push("SPEC.md");

  if (files.length === 0) return [];

  pkg.files = files;
  await fs.writeJson(packagePath, pkg, { spaces: 2 });
  return [`Added package.json files whitelist: ${files.join(", ")}`];
}

export async function doctor(options = {}) {
  const cwd = process.cwd();
  const before = await collectAudit(cwd);

  if (!options.fix) {
    if (options.json) {
      console.log(JSON.stringify({ fixed: false, changes: [], audit: before }, null, 2));
    } else {
      printAudit(before);
      console.log(chalk.cyan("Run cco doctor --fix to apply conservative fixes."));
    }
    if (options.ci && before.issues.length > 0) process.exitCode = 1;
    return { fixed: false, changes: [], audit: before };
  }

  const project = await detectProject(cwd, { lang: "auto", framework: "auto" });
  await init({ lang: project.language, framework: project.framework, force: false, quiet: options.json });

  const changes = [
    ...((await writeDefaultConfig(cwd)) ? ["Created .cco.json"] : []),
    ...(await appendMissingIgnoreEntries(cwd)),
    ...(await fixSettings(cwd)),
    ...(await cleanClaudeMd(cwd)),
    ...(await fixNpmPackagePublishList(cwd)),
  ];

  const after = await collectAudit(cwd);

  if (options.json) {
    console.log(JSON.stringify({ fixed: true, changes, audit: after }, null, 2));
  } else {
    if (changes.length > 0) {
      console.log(chalk.green("\nDoctor applied fixes:"));
      changes.forEach((change) => console.log(chalk.green(`  - ${change}`)));
    } else {
      console.log(chalk.green("\nDoctor found no safe fixes to apply."));
    }
    printAudit(after);
  }

  if (options.ci && after.issues.length > 0) process.exitCode = 1;
  return { fixed: true, changes, audit: after };
}
