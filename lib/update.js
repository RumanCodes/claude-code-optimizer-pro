import chalk from "chalk";
import fs from "fs-extra";
import path from "path";
import { execSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { hooksCommand } from "./hooks.js";
import { doctor } from "./doctor.js";

const { version: currentVersion } = createRequire(import.meta.url)("../../package.json");
const PACKAGE_NAME = "claude-code-optimizer-pro";

function getLatestVersion() {
  try {
    const output = execSync(`npm view ${PACKAGE_NAME} version`, {
      encoding: "utf8",
      timeout: 10000,
    });
    return String(output).trim();
  } catch {
    return null;
  }
}

function isGlobalInstall() {
  try {
    const output = execSync(`npm list -g ${PACKAGE_NAME} --depth=0`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return output.includes(PACKAGE_NAME);
  } catch {
    return false;
  }
}

async function updateContent(dir) {
  console.log(chalk.bold("\nUpdating project content..."));
  console.log("");

  const refresh = await doctor({ fix: true });
  if (!refresh?.changes || refresh.changes.length === 0) {
    console.log(chalk.dim("  .cco project files already reflect current defaults."));
  }

  const hooksDir = path.join(dir, ".claude", "hooks");
  if (await fs.pathExists(hooksDir)) {
    const installed = (await fs.readdir(hooksDir)).filter((name) => name.endsWith(".sh"));
    if (installed.length > 0) {
      for (const hook of installed) {
        hooksCommand("install", hook.replace(/\.sh$/, ""), {});
      }
      console.log(chalk.green(`✓ Refreshed ${installed.length} installed hook(s).`));
      console.log("");
      return;
    }
  }
  console.log(chalk.dim("  No hooks installed."));
  console.log("");
}

export async function update(options = {}) {
  const dir = process.cwd();

  if (options.content) {
    await updateContent(dir);
    return;
  }

  console.log("");
  console.log(chalk.bold("Checking for updates..."));
  console.log("");

  const latest = getLatestVersion();
  if (!latest) {
    console.log(chalk.red("✗ Could not reach npm registry. Check your internet connection."));
    process.exitCode = 1;
    return;
  }

  console.log(`  Current : ${chalk.dim(currentVersion)}`);
  console.log(`  Latest  : ${chalk.green(latest)}`);
  console.log("");
  if (currentVersion === latest) {
    console.log(chalk.green("✓ Already up to date."));
    console.log("");
    console.log(chalk.dim(`  Run ${chalk.cyan("cco update --content")} to refresh project content.`));
    console.log("");
    return;
  }

  if (!isGlobalInstall()) {
    console.log(chalk.yellow(`ℹ ${PACKAGE_NAME} is not globally installed — cannot self-update.`));
    console.log("");
    console.log(`Run:\n  npm install -g ${PACKAGE_NAME}@${latest}`);
    console.log("");
    return;
  }

  console.log(chalk.blue(`Updating ${currentVersion} → ${latest} (global install)...`));
  console.log("");
  const result = spawnSync("npm", ["install", "-g", `${PACKAGE_NAME}@${latest}`], { stdio: "inherit", shell: false });
  if (result.status !== 0) {
    console.log(chalk.red(`✗ Update failed. Try manually: npm install -g ${PACKAGE_NAME}@${latest}`));
    process.exitCode = 1;
    return;
  }

  console.log("");
  console.log(chalk.green(`✓ Updated to ${latest}`));
  console.log("");
  console.log(chalk.dim(`  Run ${chalk.cyan("cco update --content")} to refresh project content too.`));
}
