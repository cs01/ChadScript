// docs/SUBSET.md is generated from the validator (scripts/gen-subset.ts). This test fails if the
// checked-in copy is out of date — i.e. someone changed an allowlist or rejection code without
// running the generator — keeping the doc a true single source of truth, never hand-drifted.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateSubsetMarkdown } from "../../scripts/gen-subset.js";

test("docs/SUBSET.md matches generated output (run `bun run scripts/gen-subset.ts`)", () => {
  const path = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "docs", "SUBSET.md");
  const onDisk = readFileSync(path, "utf8");
  assert.equal(onDisk, generateSubsetMarkdown(), "docs/SUBSET.md is stale — regenerate it");
});
