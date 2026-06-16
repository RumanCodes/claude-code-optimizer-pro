import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { collectAudit } from "../lib/audit.js";
import { doctor } from "../lib/doctor.js";

test("doctor --fix repairs a missing optimizer setup", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cco-doctor-"));
  const originalCwd = process.cwd();
  try {
    process.chdir(dir);
    await fs.writeJson(path.join(dir, "package.json"), { name: "sample", version: "1.0.0" });
    const before = await collectAudit(dir);
    assert.equal(before.issues.length > 0, true);

    await doctor({ fix: true });
    const after = await collectAudit(dir);
    assert.equal(after.issues.length, 0);
    assert.equal(await fs.pathExists(path.join(dir, ".cco.json")), true);
  } finally {
    process.chdir(originalCwd);
    await fs.remove(dir);
  }
});

test("custom .cco.json budgets affect audit", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cco-config-"));
  try {
    await fs.writeJson(path.join(dir, ".cco.json"), { maxClaudeMdLines: 1 });
    await fs.writeFile(path.join(dir, "CLAUDE.md"), "# Test\n\n## One\nText\n");
    await fs.writeFile(path.join(dir, ".claudeignore"), "node_modules\ndist\n.git\n*.log\n.env\n");
    await fs.outputJson(path.join(dir, ".claude/settings.json"), { bash: { maxOutputLength: 20000 } });
    await fs.ensureDir(path.join(dir, ".claude/commands"));
    await fs.writeFile(path.join(dir, ".claude/commands/test.md"), "# Test");

    const result = await collectAudit(dir);
    assert.equal(result.issues.some((issue) => issue.includes("lines")), true);
  } finally {
    await fs.remove(dir);
  }
});

test("invalid .cco.json reports a clear audit issue", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cco-bad-config-"));
  const originalCwd = process.cwd();
  try {
    process.chdir(dir);
    await fs.writeFile(path.join(dir, ".cco.json"), '{ "maxClaudeMdLines": 10 ');
    await fs.writeFile(path.join(dir, "CLAUDE.md"), "# test\n");
    const result = await collectAudit(dir);
    assert.equal(
      result.issues.some((issue) => issue.includes("Invalid .cco.json")),
      true
    );
  } finally {
    process.chdir(originalCwd);
    await fs.remove(dir);
  }
});
