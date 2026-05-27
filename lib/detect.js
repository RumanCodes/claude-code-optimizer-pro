import fs from "fs-extra";
import path from "path";

async function hasFile(cwd, file) {
  return fs.pathExists(path.join(cwd, file));
}

async function readPackageJson(cwd) {
  const file = path.join(cwd, "package.json");
  if (!(await fs.pathExists(file))) return null;
  return fs.readJson(file);
}

function detectFrameworkFromPackage(pkg) {
  if (!pkg) return "none";

  const deps = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
  };

  if (deps.next) return "next";
  if (deps.react) return "react";
  if (deps.express) return "express";
  if (deps.fastify) return "fastify";
  if (deps.vue || deps.nuxt) return deps.nuxt ? "nuxt" : "vue";
  if (deps.svelte || deps["@sveltejs/kit"]) return deps["@sveltejs/kit"] ? "sveltekit" : "svelte";
  return "none";
}

function applyPreset(project, preset) {
  if (!preset || preset === "auto") return project;
  const presets = {
    next: { language: "ts", framework: "next" },
    react: { language: "ts", framework: "react" },
    express: { language: "ts", framework: "express" },
    fastapi: { language: "python", framework: "fastapi", packageManager: "pip" },
    "npm-package": { language: "js", framework: "none", packageManager: "npm" },
    monorepo: { monorepo: true },
  };
  return { ...project, ...(presets[preset] || {}) };
}

function scriptCommand(pkg, name, runner, fallback) {
  if (pkg?.scripts?.[name]) return `${runner} ${name}`;
  return fallback;
}

async function listExistingDirs(cwd, candidates) {
  const dirs = [];
  for (const dir of candidates) {
    const fullPath = path.join(cwd, dir);
    if ((await fs.pathExists(fullPath)) && (await fs.stat(fullPath)).isDirectory()) {
      dirs.push(dir);
    }
  }
  return dirs;
}

export async function detectProject(cwd = process.cwd(), options = {}) {
  const pkg = await readPackageJson(cwd);
  const hasTsConfig = await hasFile(cwd, "tsconfig.json");
  const hasGoMod = await hasFile(cwd, "go.mod");
  const hasPyProject = await hasFile(cwd, "pyproject.toml");
  const hasRequirements = await hasFile(cwd, "requirements.txt");

  let language = "ts";
  if (hasGoMod) language = "go";
  else if (hasPyProject || hasRequirements) language = "python";
  else if (pkg && !hasTsConfig) language = "js";
  else if (hasTsConfig) language = "ts";

  let framework = detectFrameworkFromPackage(pkg);
  if (framework === "none" && (await hasFile(cwd, "manage.py"))) framework = "django";
  if (framework === "none" && hasPyProject) framework = "python";

  let packageManager = "npm";
  if (await hasFile(cwd, "pnpm-lock.yaml")) packageManager = "pnpm";
  else if (await hasFile(cwd, "yarn.lock")) packageManager = "yarn";
  else if (await hasFile(cwd, "bun.lockb")) packageManager = "bun";
  else if (hasGoMod) packageManager = "go";
  else if (hasPyProject || hasRequirements) packageManager = "pip";

  if (options.lang && options.lang !== "auto") language = options.lang;
  if (options.framework && options.framework !== "auto") framework = options.framework;
  const monorepo = Boolean(
    options.monorepo ||
    pkg?.workspaces ||
    (await hasFile(cwd, "pnpm-workspace.yaml")) ||
    (await hasFile(cwd, "lerna.json")) ||
    (await hasFile(cwd, "turbo.json"))
  );

  const sourceDirs = await listExistingDirs(cwd, [
    "src",
    "app",
    "pages",
    "components",
    "lib",
    "server",
    "tests",
    "test",
    "docs",
  ]);

  const packageRunner = packageManager === "npm" ? "npm run" : `${packageManager} run`;
  const installCommand = {
    npm: "npm install",
    pnpm: "pnpm install",
    yarn: "yarn install",
    bun: "bun install",
    go: "go mod download",
    pip: hasPyProject ? "pip install -e ." : "pip install -r requirements.txt",
  }[packageManager] || "npm install";

  const commands = {
    install: installCommand,
    dev: pkg?.scripts?.dev ? `${packageRunner} dev` : "",
    test: pkg?.scripts?.test ? `${packageRunner} test 2>&1 | tail -n 100` : language === "go" ? "go test ./..." : "npm test 2>&1 | tail -n 100",
    lint: scriptCommand(pkg, "lint", packageRunner, ""),
    format: scriptCommand(pkg, "format", packageRunner, ""),
    build: pkg?.scripts?.build ? `${packageRunner} build` : "",
  };

  return applyPreset({
    language,
    framework,
    packageManager,
    sourceDirs,
    commands,
    monorepo,
    preset: options.preset || "auto",
  }, options.preset);
}
