import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { collectStats } from "../lib/stats.js";
import { runWatchSnapshot } from "../lib/watch.js";
import { estimateTokens } from "../lib/token.js";

test("estimateTokens returns stable non-zero estimates", () => {
  assert.equal(estimateTokens("hello world") > 0, true);
  assert.equal(estimateTokens(""), 0);
});

test("stats and watch snapshot include expected data", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cco-watch-"));
  try {
    await fs.writeFile(path.join(dir, "CLAUDE.md"), "# Test\n\n## Commands\nnpm test\n");
    await fs.writeFile(path.join(dir, ".claudeignore"), "node_modules\ndist\n.git\n*.log\n.env\n");
    await fs.outputJson(path.join(dir, ".claude/settings.json"), { bash: { maxOutputLength: 20000 } });
    await fs.ensureDir(path.join(dir, ".claude/commands"));
    await fs.writeFile(path.join(dir, ".claude/commands/test.md"), "# Test");
    await fs.writeFile(path.join(dir, ".env"), "SECRET=value");

    const stats = await collectStats(dir);
    assert.equal(stats.exists, true);
    assert.equal(stats.tokens > 0, true);

    const snapshot = await runWatchSnapshot(dir);
    assert.equal(snapshot.risks.some((risk) => risk.includes(".env")), true);
  } finally {
    await fs.remove(dir);
  }
});
