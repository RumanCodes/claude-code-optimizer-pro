import fs from "fs-extra";
import path from "path";
import { detectProject } from "./detect.js";

const DEFAULT_MAX_FILE_BYTES = 120_000;
const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".py", ".go"]);
const CONFIG_FILES = [
  "package.json",
  "tsconfig.json",
  "jsconfig.json",
  "next.config.js",
  "next.config.mjs",
  "vite.config.js",
  "vite.config.ts",
  "tailwind.config.js",
  "tailwind.config.ts",
  "eslint.config.js",
  "jest.config.js",
  "jest.config.ts",
  "vitest.config.js",
  "vitest.config.ts",
  "playwright.config.js",
  "playwright.config.ts",
  "prisma/schema.prisma",
  "pyproject.toml",
  "requirements.txt",
  "go.mod",
];
const IGNORE_DIRS = new Set([
  ".git",
  ".next",
  ".nuxt",
  ".svelte-kit",
  "node_modules",
  "dist",
  "build",
  "out",
  "coverage",
  ".cache",
  ".venv",
  "venv",
]);
const SECRET_NAMES = new Set([".env", ".env.local"]);

async function readPackage(cwd) {
  const packagePath = path.join(cwd, "package.json");
  if (!(await fs.pathExists(packagePath))) return null;
  return fs.readJson(packagePath);
}

function depsFromPackage(pkg) {
  return {
    ...pkg?.dependencies,
    ...pkg?.devDependencies,
    ...pkg?.peerDependencies,
  };
}

function presentDeps(deps, names) {
  return names.filter((name) => {
    if (name.endsWith("/*")) {
      const prefix = name.slice(0, -1);
      return Object.keys(deps).some((dep) => dep.startsWith(prefix));
    }
    return Boolean(deps[name]);
  });
}

function detectLibraries(deps, configFiles) {
  return {
    frameworks: presentDeps(deps, ["next", "react", "express", "fastify", "vue", "nuxt", "svelte", "@sveltejs/kit"]),
    test: presentDeps(deps, ["vitest", "jest", "mocha", "playwright", "@playwright/test", "cypress"]),
    database: presentDeps(deps, ["prisma", "@prisma/client", "drizzle-orm", "mongoose", "typeorm", "sequelize"]),
    auth: presentDeps(deps, ["next-auth", "@clerk/*", "passport", "lucia", "better-auth"]),
    state: presentDeps(deps, ["zustand", "redux", "@reduxjs/toolkit", "jotai", "mobx"]),
    styling: [
      ...presentDeps(deps, ["tailwindcss", "sass", "styled-components", "@emotion/react"]),
      ...(configFiles.includes("tailwind.config.js") || configFiles.includes("tailwind.config.ts") ? ["tailwind-config"] : []),
    ],
    validation: presentDeps(deps, ["zod", "yup", "joi", "valibot"]),
  };
}

async function safeRead(cwd, relativePath, maxBytes) {
  if (SECRET_NAMES.has(path.basename(relativePath))) return "";
  const fullPath = path.join(cwd, relativePath);
  const stat = await fs.stat(fullPath);
  if (stat.size > maxBytes) return "";
  return fs.readFile(fullPath, "utf8");
}

async function existingConfigFiles(cwd) {
  const found = [];
  for (const file of CONFIG_FILES) {
    if (await fs.pathExists(path.join(cwd, file))) found.push(file);
  }
  return found;
}

async function walkSourceFiles(cwd, dir = ".", results = [], options = {}) {
  const maxFiles = options.maxFiles || 80;
  if (results.length >= maxFiles) return results;

  const fullDir = path.join(cwd, dir);
  if (!(await fs.pathExists(fullDir))) return results;

  const entries = await fs.readdir(fullDir, { withFileTypes: true });
  for (const entry of entries) {
    if (results.length >= maxFiles) break;
    const relativePath = path.join(dir, entry.name);
    const normalized = relativePath.replace(/\\/g, "/").replace(/^\.\//, "");

    if (entry.isDirectory()) {
      if (!IGNORE_DIRS.has(entry.name)) {
        await walkSourceFiles(cwd, relativePath, results, options);
      }
      continue;
    }

    if (!entry.isFile()) continue;
    if (SECRET_NAMES.has(entry.name)) continue;
    if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      results.push(normalized);
    }
  }

  return results;
}

function detectPathGroups(files, configFiles) {
  const hasPrefix = (prefix) => files.some((file) => file.startsWith(prefix));
  return {
    apiDirs: [
      hasPrefix("app/api/") ? "app/api" : null,
      hasPrefix("src/api/") ? "src/api" : null,
      hasPrefix("server/") ? "server" : null,
      hasPrefix("routes/") ? "routes" : null,
    ].filter(Boolean),
    componentDirs: [
      hasPrefix("src/components/") ? "src/components" : null,
      hasPrefix("components/") ? "components" : null,
      hasPrefix("src/ui/") ? "src/ui" : null,
    ].filter(Boolean),
    testDirs: [
      hasPrefix("test/") ? "test" : null,
      hasPrefix("tests/") ? "tests" : null,
    ].filter(Boolean),
    databaseDirs: [
      configFiles.includes("prisma/schema.prisma") ? "prisma" : null,
      hasPrefix("src/db/") ? "src/db" : null,
    ].filter(Boolean),
  };
}

function isTestFile(file) {
  return file.startsWith("test/") ||
    file.startsWith("tests/") ||
    file.includes(".test.") ||
    file.includes(".spec.");
}

function sourcePatterns(fileItems) {
  const implementationItems = fileItems.filter((item) => !isTestFile(item.file));
  const implementationContents = implementationItems.map((item) => item.content);
  const allContent = fileItems.map((item) => `${item.file}\n${item.content}`);
  const joined = implementationContents.join("\n");
  const hasZodImport = implementationContents.some((content) => {
    return content.split("\n").some((line) => {
      return !line.includes("usesZod") &&
        !line.includes("from\\s+") &&
        (/from\s+["']zod["']/.test(line) || /require\(["']zod["']\)/.test(line));
    });
  });
  return {
    usesAsyncAwait: /\basync\s+function\b|\bawait\b/.test(joined),
    usesZod: hasZodImport,
    usesImportAlias: /from\s+["']@\//.test(joined),
    usesReactFunctions: /function\s+[A-Z][A-Za-z0-9_]*\s*\(|const\s+[A-Z][A-Za-z0-9_]*\s*=/.test(joined),
    colocatedTests: allContent.some((content) => /\.test\.|\.spec\./.test(content)),
  };
}

function buildConventions(project, libraries, groups, patterns) {
  const conventions = [];
  if (project.language === "ts") conventions.push("Use TypeScript for implementation changes.");
  if (patterns.usesAsyncAwait) conventions.push("Prefer async/await for asynchronous code.");
  if (libraries.validation.includes("zod") || patterns.usesZod) conventions.push("Use Zod for input validation.");
  if (libraries.database.includes("prisma") || libraries.database.includes("@prisma/client")) conventions.push("Use Prisma for database access.");
  if (libraries.styling.includes("tailwindcss") || libraries.styling.includes("tailwind-config")) conventions.push("Use Tailwind CSS utility classes for styling.");
  if (patterns.usesImportAlias) conventions.push("Project imports use the @/ alias.");
  if (groups.componentDirs.length > 0) conventions.push(`React/UI components live in ${groups.componentDirs.join(", ")}.`);
  if (groups.apiDirs.length > 0) conventions.push(`API/server code lives in ${groups.apiDirs.join(", ")}.`);
  if (libraries.test.length > 0) conventions.push(`Tests use ${libraries.test.join(", ")}.`);
  if (patterns.colocatedTests) conventions.push("Tests appear to use colocated *.test or *.spec files.");
  return [...new Set(conventions)];
}

function buildRisks(cwd, configFiles, groups) {
  const risks = [];
  if (!configFiles.includes(".env.example")) risks.push("No .env.example detected; document required environment variables if the app needs secrets.");
  if (groups.apiDirs.length === 0) risks.push("No obvious API/server directory detected.");
  return risks;
}

export async function analyzeRepository(cwd = process.cwd(), options = {}) {
  const maxFileBytes = Number(options.maxFileBytes || DEFAULT_MAX_FILE_BYTES);
  const project = await detectProject(cwd, options);
  const pkg = await readPackage(cwd);
  const deps = depsFromPackage(pkg);
  const configFiles = await existingConfigFiles(cwd);
  const sourceFiles = await walkSourceFiles(cwd, ".", [], { maxFiles: Number(options.maxFiles || 80) });
  const readableSourceFiles = [];

  for (const file of sourceFiles.slice(0, Number(options.sampleFiles || 30))) {
    try {
      const content = await safeRead(cwd, file, maxFileBytes);
      if (content) readableSourceFiles.push({ file, content });
    } catch {
      // Ignore unreadable files; analysis is best-effort.
    }
  }

  const libraries = detectLibraries(deps, configFiles);
  const groups = detectPathGroups(sourceFiles, configFiles);
  const patterns = sourcePatterns(readableSourceFiles);
  const conventions = buildConventions(project, libraries, groups, patterns);
  const risks = buildRisks(cwd, configFiles, groups);

  return {
    cwd,
    project,
    architecture: {
      sourceDirs: project.sourceDirs,
      scannedFiles: sourceFiles.length,
      sampledFiles: readableSourceFiles.map((item) => item.file),
      ...groups,
    },
    package: {
      scripts: pkg?.scripts || {},
      dependencies: Object.keys(deps).sort(),
    },
    configFiles,
    libraries,
    patterns,
    conventions,
    risks,
  };
}

export function printAnalysis(analysis) {
  console.log(`\nRepository analysis: ${analysis.cwd}\n`);
  console.log(`Language: ${analysis.project.language}`);
  console.log(`Framework: ${analysis.project.framework}`);
  console.log(`Package manager: ${analysis.project.packageManager}`);
  console.log(`Monorepo: ${analysis.project.monorepo ? "yes" : "no"}`);
  console.log(`Scanned source files: ${analysis.architecture.scannedFiles}`);
  console.log("\nDetected libraries:");
  for (const [group, values] of Object.entries(analysis.libraries)) {
    console.log(`  ${group}: ${values.length ? values.join(", ") : "none"}`);
  }
  console.log("\nConventions:");
  (analysis.conventions.length ? analysis.conventions : ["No strong conventions detected."]).forEach((item) => console.log(`  - ${item}`));
  console.log("\nRisks:");
  (analysis.risks.length ? analysis.risks : ["No analysis risks detected."]).forEach((item) => console.log(`  - ${item}`));
  console.log();
}

export async function analyze(options = {}) {
  const analysis = await analyzeRepository(process.cwd(), options);
  if (options.json) console.log(JSON.stringify(analysis, null, 2));
  else printAnalysis(analysis);
  return analysis;
}
