import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { init } from "../lib/init.js";
import { detectProject } from "../lib/detect.js";

test("detectProject detects pnpm react typescript projects", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cco-detect-"));
  try {
    await fs.writeJson(path.join(dir, "package.json"), {
      scripts: { dev: "vite", test: "vitest", lint: "eslint ." },
      dependencies: { react: "latest" },
    });
    await fs.writeFile(path.join(dir, "tsconfig.json"), "{}");
    await fs.writeFile(path.join(dir, "pnpm-lock.yaml"), "lockfileVersion: 9");

    const project = await detectProject(dir);
    assert.equal(project.language, "ts");
    assert.equal(project.framework, "react");
    assert.equal(project.packageManager, "pnpm");
    assert.equal(project.commands.test, "pnpm run test 2>&1 | tail -n 100");
  } finally {
    await fs.remove(dir);
  }
});

test("init creates optimizer files", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cco-init-"));
  const originalCwd = process.cwd();
  try {
    process.chdir(dir);
    await init({ lang: "auto", framework: "auto", preset: "auto", quiet: true });
    assert.equal(await fs.pathExists(path.join(dir, "CLAUDE.md")), true);
    assert.equal(await fs.pathExists(path.join(dir, ".claudeignore")), true);
    assert.equal(await fs.pathExists(path.join(dir, ".claude/settings.json")), true);
  } finally {
    process.chdir(originalCwd);
    await fs.remove(dir);
  }
});
