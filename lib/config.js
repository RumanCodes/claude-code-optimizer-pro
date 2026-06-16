import fs from "fs-extra";
import path from "path";

export const DEFAULT_CONFIG = {
  maxClaudeMdLines: 200,
  maxClaudeMdTokens: 2000,
  targetClaudeMdTokens: 1500,
  maxBashOutputLength: 20000,
  maxLargeFileBytes: 500_000,
  requiredIgnoreEntries: ["node_modules", "dist", ".git", "*.log", ".env"],
  ciFailOnWarnings: true,
};

export async function loadConfig(cwd = process.cwd()) {
  const configPath = path.join(cwd, ".cco.json");
  if (!(await fs.pathExists(configPath))) {
    return { ...DEFAULT_CONFIG, path: configPath, exists: false };
  }

  let userConfig = {};
  let parseError = null;

  try {
    userConfig = await fs.readJson(configPath);
  } catch (error) {
    parseError = `Invalid .cco.json: ${error.message}`;
  }
  if (!userConfig || typeof userConfig !== "object" || Array.isArray(userConfig)) {
    userConfig = {};
  }

  const requiredIgnoreEntries = Array.isArray(userConfig.requiredIgnoreEntries) && userConfig.requiredIgnoreEntries.length > 0
    ? userConfig.requiredIgnoreEntries
    : DEFAULT_CONFIG.requiredIgnoreEntries;

  return {
    ...DEFAULT_CONFIG,
    ...userConfig,
    requiredIgnoreEntries,
    path: configPath,
    exists: true,
    parseError,
  };
}

export async function writeDefaultConfig(cwd = process.cwd()) {
  const configPath = path.join(cwd, ".cco.json");
  if (await fs.pathExists(configPath)) return false;
  await fs.outputJson(configPath, DEFAULT_CONFIG, { spaces: 2 });
  return true;
}
