import chalk from "chalk";
import fs from "fs-extra";
import path from "path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const TEMPLATES_DIR = path.resolve(__dirname, "../../templates/hooks");
const HOOKS_INSTALL_DIR = path.join(process.cwd(), ".claude", "hooks");

export function parseHookMeta(content) {
  const event = (content.match(/^# EVENT:\s*(.+)$/m) || [])[1]?.trim() ?? "Unknown";
  const desc = (content.match(/^# DESCRIPTION:\s*(.+)$/m) || [])[1]?.trim() ?? "";
  return { event, desc };
}

function buildSettingsBlock(installedHooks) {
  const byEvent = {};
  for (const hook of installedHooks) {
    if (!byEvent[hook.event]) byEvent[hook.event] = [];
    byEvent[hook.event].push({
      hooks: [{ type: "command", command: `bash .claude/hooks/${hook.file}` }],
    });
  }

  return { hooks: byEvent };
}

export function formatHookLine(hook) {
  const status = hook.installed ? chalk.green("[installed]  ") : chalk.gray("[not installed]");
  return `  ${hook.name.padEnd(38)} ${status} ${chalk.cyan(hook.event.padEnd(20))} ${hook.desc}`;
}

export function readTemplates(templatesDir = TEMPLATES_DIR, installDir = HOOKS_INSTALL_DIR) {
  if (!fs.existsSync(templatesDir)) return [];
  return fs
    .readdirSync(templatesDir)
    .filter((file) => file.endsWith(".sh"))
    .map((file) => {
      const content = fs.readFileSync(path.join(templatesDir, file), "utf8");
      const { event, desc } = parseHookMeta(content);
      const installed = fs.pathExistsSync(path.join(installDir, file));
      return {
        name: file.replace(/\.sh$/, ""),
        file,
        event,
        desc,
        installed,
      };
    });
}

function confirm(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

export function listHooks() {
  const templates = readTemplates();
  if (templates.length === 0) {
    console.log(chalk.yellow("No hook templates found in templates/hooks/"));
    return;
  }

  console.log(chalk.bold("\nAvailable hooks:\n"));
  for (const hook of templates) {
    console.log(formatHookLine(hook));
  }
  console.log(chalk.dim("\nRun: cco hooks install <name>"));
}

export function installHook(name, opts = {}) {
  const templates = readTemplates();
  if (opts?.all) {
    fs.mkdirSync(HOOKS_INSTALL_DIR, { recursive: true });
    for (const hook of templates) {
      const dst = path.join(HOOKS_INSTALL_DIR, hook.file);
      fs.copyFileSync(path.join(TEMPLATES_DIR, hook.file), dst);
      fs.chmodSync(dst, 0o755);
      console.log(chalk.green(`✓ Installed: .claude/hooks/${hook.file}`));
    }
    if (templates.length > 0) {
      console.log(chalk.bold(`\n${templates.length} hooks installed.`));
      console.log(chalk.dim("Run: cco hooks settings  to get your settings.json block"));
    } else {
      console.log(chalk.dim("No hook templates available."));
    }
    return;
  }

  if (!name) {
    console.error(chalk.red("Usage: cco hooks install <name>  or  cco hooks install --all"));
    process.exitCode = 1;
    return;
  }

  const hook = templates.find((item) => item.name === name);
  if (!hook) {
    console.error(chalk.red(`Hook not found: ${name}`));
    console.error(chalk.dim(`Available: ${templates.map((item) => item.name).join(", ")}`));
    process.exitCode = 1;
    return;
  }

  fs.mkdirSync(HOOKS_INSTALL_DIR, { recursive: true });
  const dst = path.join(HOOKS_INSTALL_DIR, hook.file);
  fs.copyFileSync(path.join(TEMPLATES_DIR, hook.file), dst);
  fs.chmodSync(dst, 0o755);
  console.log(chalk.green(`✓ Installed: .claude/hooks/${hook.file}`));
  console.log(chalk.dim(`Add to ~/.claude/settings.json:`));
  console.log(
    chalk.dim(`  "${hook.event}": [{ "hooks": [{ "type": "command", "command": "bash .claude/hooks/${hook.file}" }] }]`),
  );
}

export async function removeHook(name, opts = {}) {
  if (!name) {
    console.error(chalk.red("Usage: cco hooks remove <name>"));
    process.exitCode = 1;
    return;
  }

  const fileName = `${name}.sh`;
  const target = path.join(HOOKS_INSTALL_DIR, fileName);
  if (!(await fs.pathExists(target))) {
    console.error(chalk.red(`Not installed: ${name}`));
    process.exitCode = 1;
    return;
  }

  if (!opts?.yes) {
    const answer = await confirm(`Remove .claude/hooks/${fileName}? [y/N] `);
    if (String(answer).trim().toLowerCase() !== "y") {
      console.log("Cancelled.");
      return;
    }
  }

  await fs.remove(target);
  console.log(chalk.green(`✓ Removed: .claude/hooks/${fileName}`));
}

export function statusHooks() {
  const templates = readTemplates();
  const installed = templates.filter((item) => item.installed);
  if (installed.length === 0) {
    console.log(chalk.yellow("No hooks installed. Run: cco hooks install <name>"));
    return;
  }

  console.log(chalk.bold("\nInstalled hooks:\n"));
  for (const hook of installed) {
    const stat = fs.statSync(path.join(HOOKS_INSTALL_DIR, hook.file));
    const ageMinutes = Math.round((Date.now() - stat.mtimeMs) / 60000);
    console.log(`  ${chalk.green("✓")} ${hook.name.padEnd(38)} ${chalk.cyan(hook.event.padEnd(20))} modified ${ageMinutes}m ago`);
  }
}

export function settingsHooks() {
  const templates = readTemplates();
  const installed = templates.filter((item) => item.installed);
  if (installed.length === 0) {
    console.log(chalk.yellow("No hooks installed. Run: cco hooks install --all first."));
    return;
  }

  const output = JSON.stringify(buildSettingsBlock(installed), null, 2);
  console.log(output);
  if (process.stdout.isTTY) {
    console.log(chalk.dim("\nMerge this into ~/.claude/settings.json"));
  }
}

export function hooksCommand(subcommand, name, options) {
  const action = subcommand ?? "list";
  if (action === "list") return listHooks();
  if (action === "install") return installHook(name, options);
  if (action === "remove") return removeHook(name, options);
  if (action === "status") return statusHooks();
  if (action === "settings") return settingsHooks();
  console.error(chalk.red(`Unknown subcommand: ${action}`));
  console.error(chalk.dim("Usage: cco hooks [list|install|remove|status|settings]"));
  process.exitCode = 1;
}
