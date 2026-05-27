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
