import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { init } from "./init.js";
import { collectAudit } from "./audit.js";
import { collectStats } from "./stats.js";
import { runWatchSnapshot } from "./watch.js";
import { doctor } from "./doctor.js";

export { init } from "./init.js";
export { audit, collectAudit, printAudit } from "./audit.js";
export { stats, collectStats, printStats } from "./stats.js";
export { watch, runWatchSnapshot } from "./watch.js";
export { doctor } from "./doctor.js";
export { detectProject } from "./detect.js";
export { explain } from "./explain.js";
export { loadConfig, writeDefaultConfig } from "./config.js";
export { estimateTokens } from "./token.js";
export { analyze, analyzeRepository, printAnalysis } from "./analyze.js";
export { scanRepository } from "./scanner.js";

async function runSelfTest() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "cco-test-"));
  const originalCwd = process.cwd();

  try {
    process.chdir(tempDir);
    await init({ lang: "ts", framework: "none", force: false });

    const expectedFiles = [
      ".claudeignore",
      "CLAUDE.md",
      ".claude/settings.json",
      ".claude/commands/api-rules.md",
      ".claude/commands/test-rules.md",
      ".claude/commands/ui-rules.md",
      ".claude/subagents/explore.md",
      ".claude/subagents/refactor.md",
    ];

    for (const file of expectedFiles) {
      assert.equal(await fs.pathExists(path.join(tempDir, file)), true, `${file} should exist`);
    }

    const audit = await collectAudit(tempDir);
    assert.equal(audit.passes.length >= 4, true, "audit should report passing checks");

    const stats = await collectStats(tempDir);
    assert.equal(stats.exists, true, "stats should find CLAUDE.md");
    assert.equal(stats.tokens > 0, true, "stats should estimate tokens");

    const snapshot = await runWatchSnapshot(tempDir);
    assert.equal(snapshot.stats.exists, true, "watch snapshot should include stats");

    await fs.remove(path.join(tempDir, ".claude", "settings.json"));
    await doctor({ fix: true });
    assert.equal(await fs.pathExists(path.join(tempDir, ".claude", "settings.json")), true, "doctor should recreate settings");

    console.log("\nSelf-test passed.");
  } finally {
    process.chdir(originalCwd);
    await fs.remove(tempDir);
  }
}

if (process.argv.includes("--test")) {
  runSelfTest().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
