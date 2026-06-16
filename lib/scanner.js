import fs from "fs-extra";
import path from "path";

export const DEFAULT_SCAN_OPTIONS = {
  maxFiles: 400,
  maxFileBytes: 160_000,
};

const IGNORE_DIRS = new Set([
  ".git",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".cache",
  ".claude",
  ".claude-flow",
  ".cco",
  "node_modules",
  "vendor",
  "dist",
  "build",
  "out",
  "coverage",
  "public/assets",
  ".venv",
  "venv",
  ".aws",
  ".ssh",
  ".kube",
]);

const SECRET_PATTERNS = [
  /^\.env($|\.)/,
  /\.pem$/,
  /\.key$/,
  /^\.npmrc$/,
  /^\.pypirc$/,
  /^\.netrc$/,
  /^\.yarnrc$/,
  /^\.aws$/,
  /^\.ssh$/,
  /^id_(rsa|ed25519|ecdsa|ed448|dsa)$/i,
  /^credentials$/i,
  /secret/i,
  /token/i,
];

const TEXT_EXTENSIONS = new Set([
  ".php",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".vue",
  ".py",
  ".go",
  ".css",
  ".scss",
  ".json",
  ".md",
  ".txt",
  ".yml",
  ".yaml",
  ".toml",
]);

const CONFIG_NAMES = new Set([
  "package.json",
  "composer.json",
  "tsconfig.json",
  "jsconfig.json",
  "vite.config.js",
  "vite.config.ts",
  "next.config.js",
  "tailwind.config.js",
  "tailwind.config.ts",
  "jest.config.js",
  "vitest.config.js",
  "playwright.config.js",
  "pyproject.toml",
  "requirements.txt",
  "go.mod",
  "style.css",
]);

function normalize(file) {
  return file.replace(/\\/g, "/").replace(/^\.\//, "");
}

function shouldSkipName(name) {
  return SECRET_PATTERNS.some((pattern) => pattern.test(name));
}

function shouldSkipDir(relativePath) {
  const normalized = normalize(relativePath);
  return [...IGNORE_DIRS].some((dir) => normalized === dir || normalized.startsWith(`${dir}/`));
}

function roleForFile(file) {
  const base = path.basename(file);
  const ext = path.extname(file);
  if (CONFIG_NAMES.has(base) || file === "prisma/schema.prisma") return "config";
  if (base === "functions.php" || base === "style.css") return "entrypoint";
  if (file.endsWith(".test.js") || file.endsWith(".test.ts") || file.endsWith(".spec.js") || file.endsWith(".spec.ts")) return "test";
  if (file.includes("/Views/") || file.includes("/views/") || file.includes("/templates/")) return "view";
  if (file.includes("/Controllers/") || file.includes("/controllers/")) return "controller";
  if (file.includes("/Models/") || file.includes("/models/")) return "model";
  if (file.includes("/Hooks/") || file.includes("/hooks/")) return "hook";
  if (file.includes("/components/") || file.endsWith(".vue")) return "component";
  if ([".php", ".js", ".jsx", ".ts", ".tsx", ".vue", ".py", ".go"].includes(ext)) return "source";
  if ([".css", ".scss"].includes(ext)) return "asset";
  if ([".md", ".txt"].includes(ext)) return "docs";
  return "other";
}

function languageForFile(file) {
  const ext = path.extname(file);
  return {
    ".php": "php",
    ".js": "js",
    ".jsx": "jsx",
    ".ts": "ts",
    ".tsx": "tsx",
    ".vue": "vue",
    ".py": "python",
    ".go": "go",
    ".css": "css",
    ".scss": "scss",
    ".md": "markdown",
    ".txt": "text",
    ".json": "json",
  }[ext] || "unknown";
}

export async function scanRepository(cwd = process.cwd(), options = {}) {
  const maxFiles = Number(options.maxFiles || DEFAULT_SCAN_OPTIONS.maxFiles);
  const maxFileBytes = Number(options.maxFileBytes || DEFAULT_SCAN_OPTIONS.maxFileBytes);
  const files = [];
  const skipped = [];

  async function walk(dir = ".") {
    if (files.length >= maxFiles) return;
    const fullDir = path.join(cwd, dir);
    if (!(await fs.pathExists(fullDir))) return;

    const entries = await fs.readdir(fullDir, { withFileTypes: true });
    for (const entry of entries) {
      if (files.length >= maxFiles) break;
      const relative = normalize(path.join(dir, entry.name));

      if (entry.isDirectory()) {
        if (shouldSkipDir(relative)) {
          skipped.push({ file: relative, reason: "ignored-directory" });
          continue;
        }
        await walk(relative);
        continue;
      }

      if (!entry.isFile()) continue;
      if (shouldSkipName(entry.name)) {
        skipped.push({ file: relative, reason: "secret-like-name" });
        continue;
      }

      const ext = path.extname(entry.name);
      if (!TEXT_EXTENSIONS.has(ext) && !CONFIG_NAMES.has(entry.name)) {
        skipped.push({ file: relative, reason: "non-text-extension" });
        continue;
      }

      const fullPath = path.join(cwd, relative);
      let stat;
      try {
        stat = await fs.stat(fullPath);
      } catch {
        skipped.push({ file: relative, reason: "stat-failed" });
        continue;
      }
      if (stat.size > maxFileBytes) {
        skipped.push({ file: relative, reason: "too-large", bytes: stat.size });
        continue;
      }

      files.push({
        file: relative,
        role: roleForFile(relative),
        language: languageForFile(relative),
        bytes: stat.size,
      });
    }
  }

  await walk();

  return {
    cwd,
    files,
    skipped,
    byRole: files.reduce((acc, item) => {
      acc[item.role] = acc[item.role] || [];
      acc[item.role].push(item.file);
      return acc;
    }, {}),
    byLanguage: files.reduce((acc, item) => {
      acc[item.language] = acc[item.language] || [];
      acc[item.language].push(item.file);
      return acc;
    }, {}),
  };
}
