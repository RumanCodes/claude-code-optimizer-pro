import fs from "fs-extra";
import path from "path";
import { detectProject } from "./detect.js";
import { scanRepository } from "./scanner.js";

const DEFAULT_MAX_FILE_BYTES = 120_000;
const SOURCE_EXTENSIONS = new Set([".php", ".js", ".jsx", ".ts", ".tsx", ".vue", ".py", ".go"]);
const CONFIG_FILES = [
  "package.json",
  "composer.json",
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
  "readme.txt",
  "README.md",
  "readme.md",
  ".env.example",
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

async function readComposer(cwd) {
  const composerPath = path.join(cwd, "composer.json");
  if (!(await fs.pathExists(composerPath))) return null;
  return fs.readJson(composerPath);
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

function parseWordPressPluginHeader(file, content) {
  if (!content.includes("Plugin Name:")) return null;
  const fields = {};
  const wanted = ["Plugin Name", "Description", "Version", "Requires PHP", "Requires at least", "Text Domain", "Domain Path"];
  for (const field of wanted) {
    const match = content.match(new RegExp(`\\*\\s*${field}:\\s*(.+)`));
    if (match) fields[field] = match[1].trim();
  }
  return Object.keys(fields).length ? { file, ...fields } : null;
}

function parseThemeHeader(file, content) {
  if (path.basename(file) !== "style.css" || !content.includes("Theme Name:")) return null;
  const fields = {};
  for (const field of ["Theme Name", "Description", "Version", "Text Domain", "Requires PHP"]) {
    const match = content.match(new RegExp(`${field}:\\s*(.+)`));
    if (match) fields[field] = match[1].trim();
  }
  return Object.keys(fields).length ? { file, ...fields } : null;
}

function normalizePurposeText(value) {
  if (!value) return "";
  return value
    .replace(/^[\s*`#>\-]+/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+$/g, "")
    .trim();
}

function firstSentence(text) {
  if (!text) return null;
  const cleaned = normalizePurposeText(text);
  if (!cleaned) return null;
  const trimmed = cleaned.length > 220 ? `${cleaned.slice(0, 217).trim()}...` : cleaned;
  const match = trimmed.match(/^(.+?[.!?])(\s|$)/);
  return match?.[1] ? normalizePurposeText(match[1]) : trimmed;
}

function readmePurposeFromReadmeTxt(content) {
  const headerMatch = content.match(/^===\s*(.+?)\s*===/m);
  if (headerMatch?.[1]) {
    const header = headerMatch[1].trim();
    const chunks = header.split(/\s*[–—-]\s*/);
    const purpose = chunks.length > 1 ? chunks.slice(1).join(" - ") : chunks[0];
    const first = firstSentence(purpose);
    if (first) return first;
  }

  const descriptionMatch = content.match(/^==\s*Description\s*==\s*\n([\s\S]*?)(^==\s*|^={2,}\s*$|\s*$)/im);
  if (!descriptionMatch?.[1]) return null;

  const descriptionLines = descriptionMatch[1]
    .split("\n")
    .map((line) => normalizePurposeText(line))
    .filter((line) => line && !line.startsWith("*") && line.length > 8);
  const first = firstSentence(descriptionLines[0]);
  return first || null;
}

function readmePurposeFromMarkdown(content) {
  const headingMatch = content.match(/^#\s+(.+)$/m);
  if (headingMatch?.[1]) {
    const first = firstSentence(headingMatch[1]);
    if (first) return first;
  }

  for (const line of content.split("\n")) {
    const cleaned = firstSentence(line);
    if (cleaned && cleaned.length > 8) return cleaned;
  }
  return null;
}

function extractReadmePurpose(content, filename) {
  if (!content) return null;
  const normalizedName = filename.toLowerCase();
  if (normalizedName === "readme.txt") return readmePurposeFromReadmeTxt(content);
  if (normalizedName === "readme.md") return readmePurposeFromMarkdown(content);
  return null;
}

function resolveProjectPurpose(pluginHeader, themeHeader, pkg, composer, readmePurpose) {
  if (readmePurpose) return readmePurpose;
  const fallback = pluginHeader?.Description || themeHeader?.Description || pkg?.description || composer?.description;
  return firstSentence(fallback) || "WordPress plugin and dashboard tooling for site-level operations.";
}

function extractPhpSymbols(file, content) {
  const namespace = content.match(/namespace\s+([^;]+);/)?.[1]?.trim() || null;
  const classes = [...content.matchAll(/class\s+([A-Za-z0-9_]+)/g)].map((match) => ({
    name: match[1],
    file,
    namespace,
  }));
  const methods = [...content.matchAll(/public\s+function\s+([A-Za-z0-9_]+)/g)].map((match) => match[1]);
  const hooks = [...content.matchAll(/add_(action|filter)\(\s*['"]([^'"]+)['"]\s*,\s*([^\)]+)\)/g)].map((match) => ({
    type: match[1],
    hook: match[2],
    callback: match[3].replace(/\s+/g, " ").trim(),
    file,
  }));
  const ajaxActions = [...content.matchAll(/wp_ajax_([A-Za-z0-9_]+)/g)].map((match) => ({
    action: match[1],
    file,
  }));
  const nonces = [...content.matchAll(/check_ajax_referer\(\s*['"]([^'"]+)['"]/g)].map((match) => match[1]);
  const capabilities = [...content.matchAll(/current_user_can\(\s*['"]([^'"]+)['"]/g)].map((match) => match[1]);
  const options = [...content.matchAll(/\b(?:get|update|delete)_option\(\s*['"]([^'"]+)['"]/g)].map((match) => match[1]);
  const tables = [...content.matchAll(/->table\(\s*['"]([^'"]+)['"]/g)].map((match) => match[1]);

  return { namespace, classes, methods, hooks, ajaxActions, nonces, capabilities, options, tables };
}

function extractVueSymbols(file, content) {
  const imports = [...content.matchAll(/import\s+([A-Za-z0-9_]+)\s+from\s+['"]([^'"]+)['"]/g)].map((match) => ({
    name: match[1],
    source: match[2],
  }));
  const globals = [...content.matchAll(/window\.([A-Za-z0-9_]+)/g)]
    .map((match) => match[1])
    .filter((name) => !["open", "location", "history", "document"].includes(name));
  return {
    component: path.basename(file, ".vue"),
    file,
    imports,
    globals: [...new Set(globals)],
    scriptSetup: content.includes("<script setup"),
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

async function extractReadmePurposeFromConfig(cwd, configFiles, maxBytes) {
  for (const file of configFiles) {
    if (!/^readme\./i.test(file)) continue;
    const raw = await safeRead(cwd, file, maxBytes);
    const purpose = extractReadmePurpose(raw, file);
    if (purpose) return purpose;
  }
  return null;
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
  const lowerFiles = files.map((file) => file.toLowerCase());
  const detectPathCase = (prefix) => {
    const target = prefix.toLowerCase().replace(/\/+$/, "");
    for (const file of files) {
      const lowerParts = file.toLowerCase().split("/");
      const fileParts = file.split("/");
      const wanted = target.split("/");
      const matches = wanted.every((segment, idx) => lowerParts[idx] === segment);
      if (matches && fileParts.length >= wanted.length) {
        return fileParts.slice(0, wanted.length).join("/");
      }
    }
    return null;
  };
  const hasPrefix = (prefix) => lowerFiles.some((file) => file.startsWith(prefix.toLowerCase()));

  return {
    apiDirs: [
      detectPathCase("app/api") || null,
      detectPathCase("app/Http/Controllers") || null,
      detectPathCase("src/api") || null,
      detectPathCase("server") || null,
      hasPrefix("routes/") ? "routes" : null,
    ].filter(Boolean),
    componentDirs: [
      detectPathCase("src/components") || null,
      detectPathCase("resources/js/components") || null,
      detectPathCase("components") || null,
      detectPathCase("src/ui") || null,
    ].filter(Boolean),
    testDirs: [
      detectPathCase("test") || null,
      detectPathCase("tests") || null,
    ].filter(Boolean),
    databaseDirs: [
      configFiles.includes("prisma/schema.prisma") ? "prisma" : null,
      detectPathCase("app/Models") || null,
      detectPathCase("src/db") || null,
    ].filter(Boolean),
  };
}

function prioritizeSourceFiles(sourceFiles) {
  const isRootPath = (file) => !file.includes("/");
  const rootEntrypoints = ["functions.php", "style.css"];

  return sourceFiles
    .slice()
    .sort((a, b) => {
      const aBase = path.basename(a);
      const bBase = path.basename(b);
      const aRank = aBase === rootEntrypoints[0] || aBase === rootEntrypoints[1]
        ? 0
        : isRootPath(a) && path.extname(a) === ".php"
          ? 1
          : 2;
      const bRank = bBase === rootEntrypoints[0] || bBase === rootEntrypoints[1]
        ? 0
        : isRootPath(b) && path.extname(b) === ".php"
          ? 1
          : 2;

      if (aRank !== bRank) return aRank - bRank;
      return a.localeCompare(b);
    });
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
  if (groups.componentDirs.length > 0) conventions.push(`UI components live in ${groups.componentDirs.join(", ")}.`);
  if (groups.apiDirs.length > 0) conventions.push(`API/server code lives in ${groups.apiDirs.join(", ")}.`);
  if (libraries.test.length > 0) conventions.push(`Tests use ${libraries.test.join(", ")}.`);
  if (patterns.colocatedTests) conventions.push("Tests appear to use colocated *.test or *.spec files.");
  if (patterns.wordpress?.nonce) conventions.push(`AJAX handlers use nonce ${patterns.wordpress.nonce}.`);
  if (patterns.wordpress?.capabilities?.length) conventions.push(`Privileged WordPress actions check ${patterns.wordpress.capabilities.join(", ")} capability.`);
  if (patterns.wordpress?.tables?.length) conventions.push(`Data access uses wpFluent() tables: ${patterns.wordpress.tables.join(", ")}.`);
  if (patterns.wordpress?.amountsInCents) conventions.push("Payment amounts appear to be stored in cents and formatted by dividing by 100.");
  if (patterns.wordpress?.textDomain) conventions.push(`WordPress text domain is ${patterns.wordpress.textDomain}.`);
  if (patterns.vue?.globals?.length) conventions.push(`Vue admin UI reads localized globals: ${patterns.vue.globals.join(", ")}.`);
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
  const scan = await scanRepository(cwd, options);
  const project = await detectProject(cwd, options);
  const pkg = await readPackage(cwd);
  const composer = await readComposer(cwd);
  const deps = depsFromPackage(pkg);
  const configFiles = await existingConfigFiles(cwd);
  const readmePurpose = await extractReadmePurposeFromConfig(cwd, configFiles, maxFileBytes);
  const sourceFiles = scan.files
    .filter((item) => ["source", "controller", "model", "hook", "component", "view", "entrypoint", "config"].includes(item.role))
    .map((item) => item.file);
  const prioritizedSourceFiles = prioritizeSourceFiles(sourceFiles);
  const readableSourceFiles = [];

  for (const file of prioritizedSourceFiles.slice(0, Number(options.sampleFiles || 30))) {
    try {
      const content = await safeRead(cwd, file, maxFileBytes);
      if (content) readableSourceFiles.push({ file, content });
    } catch {
      // Ignore unreadable files; analysis is best-effort.
    }
  }

  const phpFacts = { namespaces: [], classes: [], hooks: [], ajaxActions: [], nonces: [], capabilities: [], options: [], tables: [] };
  const vueFacts = { components: [], globals: [] };
  let pluginHeader = null;
  let themeHeader = null;

  for (const item of readableSourceFiles) {
    if (item.file.endsWith(".php")) {
      pluginHeader = pluginHeader || parseWordPressPluginHeader(item.file, item.content);
      const symbols = extractPhpSymbols(item.file, item.content);
      if (symbols.namespace) phpFacts.namespaces.push(symbols.namespace);
      phpFacts.classes.push(...symbols.classes.map((klass) => ({ ...klass, methods: item.content.includes(`class ${klass.name}`) ? symbols.methods : [] })));
      phpFacts.hooks.push(...symbols.hooks);
      phpFacts.ajaxActions.push(...symbols.ajaxActions);
      phpFacts.nonces.push(...symbols.nonces);
      phpFacts.capabilities.push(...symbols.capabilities);
      phpFacts.options.push(...symbols.options);
      phpFacts.tables.push(...symbols.tables);
    }
    if (item.file.endsWith(".vue")) {
      const vue = extractVueSymbols(item.file, item.content);
      vueFacts.components.push(vue);
      vueFacts.globals.push(...vue.globals);
    }
    if (path.basename(item.file) === "style.css") {
      themeHeader = themeHeader || parseThemeHeader(item.file, item.content);
    }
  }

  phpFacts.namespaces = [...new Set(phpFacts.namespaces)];
  phpFacts.nonces = [...new Set(phpFacts.nonces)];
  phpFacts.capabilities = [...new Set(phpFacts.capabilities)];
  phpFacts.options = [...new Set(phpFacts.options)];
  phpFacts.tables = [...new Set(phpFacts.tables)];
  vueFacts.globals = [...new Set(vueFacts.globals)];

  const libraries = detectLibraries(deps, configFiles);
  if (composer?.type === "wordpress-plugin" || pluginHeader) libraries.frameworks.push("wordpress-plugin");
  if (themeHeader) libraries.frameworks.push("wordpress-theme");
  const groups = detectPathGroups(sourceFiles, configFiles);
  const patterns = sourcePatterns(readableSourceFiles);
  patterns.wordpress = {
    pluginHeader,
    themeHeader,
    composerType: composer?.type || null,
    namespace: phpFacts.namespaces[0] || Object.keys(composer?.autoload?.["psr-4"] || {})[0] || null,
    psr4: composer?.autoload?.["psr-4"] || {},
    nonce: phpFacts.nonces[0] || null,
    capabilities: phpFacts.capabilities,
    ajaxPrefix: phpFacts.ajaxActions[0]?.action?.split("_")[0] || phpFacts.nonces[0]?.split("_")[0] || null,
    tables: phpFacts.tables,
    options: phpFacts.options,
    amountsInCents: readableSourceFiles.some((item) => item.file.endsWith(".php") && /payment_total\s*\/\s*100/.test(item.content)),
    textDomain: pluginHeader?.["Text Domain"] || themeHeader?.["Text Domain"] || null,
  };
  patterns.vue = {
    components: vueFacts.components.map((component) => component.component),
    globals: vueFacts.globals,
    vite: configFiles.some((file) => file.startsWith("vite.config")),
  };
  const conventions = buildConventions(project, libraries, groups, patterns);
  const risks = buildRisks(cwd, configFiles, groups);
  if (pluginHeader && !configFiles.includes("readme.txt")) risks.push("WordPress plugin readme.txt not detected.");
  if ((pluginHeader || themeHeader) && phpFacts.nonces.length === 0 && phpFacts.ajaxActions.length > 0) risks.push("AJAX actions detected without a clear nonce check.");

  const profile = pluginHeader ? "wordpress-plugin" : themeHeader ? "wordpress-theme" : project.framework;
  const entrypoints = [
    pluginHeader ? { file: pluginHeader.file, role: "WordPress plugin entrypoint", loads: Object.keys(patterns.wordpress.psr4) } : null,
    themeHeader ? { file: themeHeader.file, role: "WordPress theme stylesheet header", loads: [] } : null,
    configFiles.includes("vite.config.js") || configFiles.includes("vite.config.ts") ? { file: configFiles.find((file) => file.startsWith("vite.config")), role: "Vite build config", loads: ["resources/js/main.js"] } : null,
  ].filter(Boolean);

  const context = {
    project: {
      name: pluginHeader?.["Plugin Name"] || themeHeader?.["Theme Name"] || pkg?.name || composer?.name || path.basename(cwd),
      type: profile,
      purpose: resolveProjectPurpose(pluginHeader, themeHeader, pkg, composer, readmePurpose),
      languages: [...new Set(scan.files.map((item) => item.language).filter((language) => !["unknown", "json", "markdown", "text"].includes(language)))],
      frameworks: [...new Set(libraries.frameworks)],
    },
    entrypoints,
    symbols: {
      php: phpFacts,
      vue: vueFacts,
    },
    graph: {
      edges: [
        ...phpFacts.classes.map((klass) => [pluginHeader?.file || "entrypoint", klass.file]).filter((edge) => edge[0] !== edge[1]),
        ...vueFacts.components.flatMap((component) => component.imports.map((imported) => [component.file, imported.source])),
      ],
    },
    gaps: [
      ...(!pkg?.scripts?.test ? [{ field: "testing.strategy", question: "No test script detected. How should tests be run?", confidence: 0.25 }] : []),
      ...(!patterns.wordpress.textDomain && (pluginHeader || themeHeader) ? [{ field: "wordpress.textDomain", question: "No WordPress text domain detected.", confidence: 0.35 }] : []),
      ...(!resolveProjectPurpose(pluginHeader, themeHeader, pkg, composer, readmePurpose) ? [{ field: "project.purpose", question: "Add a one-sentence project purpose.", confidence: 0.4 }] : []),
    ],
  };

  return {
    cwd,
    profile,
    scan,
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
    context,
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
  if (options.cache) {
    await fs.outputJson(path.join(process.cwd(), ".cco", "cache", "analysis.json"), analysis, { spaces: 2 });
  }
  if (options.json) console.log(JSON.stringify(analysis, null, 2));
  else printAnalysis(analysis);
  return analysis;
}
