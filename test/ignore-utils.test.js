import test from "node:test";
import assert from "node:assert/strict";
import { findMissingIgnoreEntries, normalizeIgnoreLine } from "../lib/ignore-utils.js";

test("normalizeIgnoreLine strips comments and whitespace", () => {
  assert.equal(normalizeIgnoreLine("  node_modules # this is comment "), "node_modules");
  assert.equal(normalizeIgnoreLine("# full comment"), "");
  assert.equal(normalizeIgnoreLine("dist/"), "dist");
});

test("findMissingIgnoreEntries ignores missing entries with wildcards", () => {
  const ignore = "node_modules\n# comment\nlogs/*.log\n";
  const missing = findMissingIgnoreEntries(ignore, ["node_modules", "logs/*.log", ".env"]);
  assert.deepEqual(missing, [".env"]);
});
