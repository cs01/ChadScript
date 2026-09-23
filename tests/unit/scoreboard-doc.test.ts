// docs/reference/scoreboard.md is rendered from docs/generated/scoreboard.json, which
// scripts/scoreboard.ts writes after running the corpus. Running the corpus is slow-lane work, so
// this fast test only checks what can go stale without it: the page against the JSON, the JSON's
// own arithmetic, and that the JSON covers exactly the programs now in tests/corpus/.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { renderScoreboardMarkdown, type Scoreboard } from "../../scripts/scoreboard.js";
import { corpusPrograms } from "../harness/corpus.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const board = JSON.parse(
  readFileSync(join(root, "docs", "generated", "scoreboard.json"), "utf8"),
) as Scoreboard;

test("docs/reference/scoreboard.md matches the JSON (run `bun run scripts/scoreboard.ts --render`)", () => {
  const page = readFileSync(join(root, "docs", "reference", "scoreboard.md"), "utf8");
  assert.equal(page, renderScoreboardMarkdown(board), "scoreboard.md is stale; re-render it");
});

test("scoreboard totals add up", () => {
  assert.equal(board.match + board.rejected + board.divergent + board.crash, board.total);
  assert.equal(board.programs.length, board.total);
  for (const key of ["match", "rejected", "divergent", "crash"] as const) {
    const fromCategories = board.categories.reduce((n, c) => n + c[key], 0);
    assert.equal(fromCategories, board[key], `per-category ${key} does not sum to the total`);
    assert.equal(board.programs.filter((p) => p.outcome === key).length, board[key]);
  }
});

test("scoreboard covers exactly the corpus programs (run `bun run scripts/scoreboard.ts`)", () => {
  const onDisk = corpusPrograms()
    .map((p) => relative(root, p.path).split("\\").join("/"))
    .sort();
  assert.deepEqual(board.programs.map((p) => p.path).sort(), onDisk);
});
