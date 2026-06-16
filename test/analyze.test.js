import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { analyzeRepository } from "../lib/analyze.js";
import { init } from "../lib/init.js";

async function makeAnalyzedNextRepo() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cco-analyze-"));
  await fs.writeJson(path.join(dir, "package.json"), {
    scripts: {
      dev: "next dev",
      test: "vitest",
      lint: "eslint .",
      build: "next build",
    },
    dependencies: {
      next: "latest",
      react: "latest",
      zod: "latest",
      "@prisma/client": "latest",
      "tailwindcss": "latest",
    },
    devDependencies: {
      vitest: "latest",
      prisma: "latest",
      typescript: "latest",
    },
  });
  await fs.writeFile(path.join(dir, "tsconfig.json"), "{}");
  await fs.outputFile(path.join(dir, "app/api/users/route.ts"), "import { z } from 'zod';\nexport async function GET() { await Promise.resolve(); }\n");
  await fs.outputFile(path.join(dir, "src/components/Button.tsx"), "export function Button() { return <button />; }\n");
  await fs.outputFile(path.join(dir, "prisma/schema.prisma"), "model User { id String @id }\n");
  await fs.writeFile(path.join(dir, "tailwind.config.ts"), "export default {};\n");
  return dir;
}

test("analyzeRepository detects stack, paths, conventions, and libraries", async () => {
  const dir = await makeAnalyzedNextRepo();
  try {
    const analysis = await analyzeRepository(dir);
    assert.equal(analysis.project.framework, "next");
    assert.equal(analysis.project.language, "ts");
    assert.equal(analysis.libraries.test.includes("vitest"), true);
    assert.equal(analysis.libraries.database.includes("prisma"), true);
    assert.equal(analysis.libraries.validation.includes("zod"), true);
    assert.equal(analysis.architecture.apiDirs.includes("app/api"), true);
    assert.equal(analysis.architecture.componentDirs.includes("src/components"), true);
    assert.equal(analysis.conventions.some((item) => item.includes("Zod")), true);
  } finally {
    await fs.remove(dir);
  }
});

test("init --analyze writes analyzed CLAUDE.md and scoped commands", async () => {
  const dir = await makeAnalyzedNextRepo();
  const originalCwd = process.cwd();
  try {
    process.chdir(dir);
    await init({ lang: "auto", framework: "auto", preset: "auto", analyze: true, quiet: true });

    const claude = await fs.readFile(path.join(dir, "CLAUDE.md"), "utf8");
    assert.equal(claude.includes("Testing: vitest"), true);
    assert.equal(claude.includes("Validation: zod"), true);
    assert.equal(claude.includes("app/api/"), true);

    assert.equal(await fs.pathExists(path.join(dir, ".claude/commands/next-rules.md")), true);
    assert.equal(await fs.pathExists(path.join(dir, ".claude/commands/database-rules.md")), true);
    assert.equal(await fs.pathExists(path.join(dir, ".claude/commands/validation-rules.md")), true);
  } finally {
    process.chdir(originalCwd);
    await fs.remove(dir);
  }
});

async function makeCaseSensitiveComponentFixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cco-component-"));
  await fs.outputFile(path.join(dir, "package.json"), JSON.stringify({
    scripts: { dev: "vite", build: "vite build" },
    dependencies: { vue: "latest" },
  }));
  await fs.outputFile(path.join(dir, "vite.config.js"), "export default {};");
  await fs.outputFile(path.join(dir, "resources/js/Components/Header.vue"), "<template><div /></template>");
  await fs.outputFile(path.join(dir, "resources/js/Components/Footer.vue"), "<template><footer /></template>");
  return dir;
}

test("detectPathGroups preserves component path casing for Vue plugin folders", async () => {
  const dir = await makeCaseSensitiveComponentFixture();
  try {
    const analysis = await analyzeRepository(dir);
    assert.equal(analysis.architecture.componentDirs.includes("resources/js/Components"), true);
  } finally {
    await fs.remove(dir);
  }
});

async function makeLowSamplePluginFixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cco-plugin-sample-"));
  await fs.writeJson(path.join(dir, "composer.json"), {
    name: "vendor/example",
    type: "wordpress-plugin",
  });

  for (let i = 0; i < 60; i++) {
    await fs.outputFile(path.join(dir, "app", `file${i}.php`), `<?php\nfunction f${i}() { return ${i}; }\n`);
  }
  await fs.outputFile(
    path.join(dir, "transfer-press.php"),
    `<?php\n/**\n * Plugin Name: Transfer Press\n * Description: Transfer Press plugin\n * Text Domain: transfer-press\n */\n`
  );

  return dir;
}

test("analysis still reads root plugin header with low sample budget", async () => {
  const dir = await makeLowSamplePluginFixture();
  try {
    const analysis = await analyzeRepository(dir, { sampleFiles: 1 });
    assert.equal(analysis.context.project.name, "Transfer Press");
    assert.equal(analysis.patterns.wordpress.textDomain, "transfer-press");
  } finally {
    await fs.remove(dir);
  }
});

async function makeWordPressReadmeFixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cco-wp-readme-"));
  await fs.writeJson(path.join(dir, "composer.json"), {
    name: "vendor/example-plugin",
    type: "wordpress-plugin",
  });
  await fs.outputFile(path.join(dir, "example-plugin.php"), `<?php
/**
 * Plugin Name: Example Plugin
 * Description: Old plugin copy helper
 * Version: 1.0.0
 * Text Domain: example-plugin
 */`);
  await fs.outputFile(path.join(dir, "readme.txt"), `=== Example Plugin – Fast plugin migrations ===
Description
== Description ==
Fast plugin transfer, backup and restore without FTP. 
`);
  await fs.outputFile(path.join(dir, "app/App.php"), `<?php
namespace Example;
class App {}
`);
  await fs.outputFile(path.join(dir, "resources/js/admin.js"), "console.log('admin');\n");
  await fs.mkdir(path.join(dir, "public/assets"), { recursive: true });
  await fs.outputFile(path.join(dir, "public/assets/app.js"), "console.log('assets');\n");
  await fs.mkdir(path.join(dir, "languages"), { recursive: true });
  await fs.outputFile(path.join(dir, "languages/example.po"), "msgid \"\"\n");
  return dir;
}

test("init output uses readme-derived project purpose and richer structure", async () => {
  const dir = await makeWordPressReadmeFixture();
  const originalCwd = process.cwd();
  try {
    process.chdir(dir);
    await init({ analyze: true, quiet: true, force: true });

    const claude = await fs.readFile(path.join(dir, "CLAUDE.md"), "utf8");
    assert.equal(claude.includes("Old plugin copy helper"), false);
    assert.equal(claude.includes("Fast plugin migrations"), true);
    assert.equal(claude.includes("app/        # Project source"), true);
    assert.equal(claude.includes("public/        # Public/static assets"), true);
    assert.equal(claude.includes("languages/        # Localization files"), true);
  } finally {
    process.chdir(originalCwd);
    await fs.remove(dir);
  }
});
