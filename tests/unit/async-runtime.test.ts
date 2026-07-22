// Async-runtime behavior (runtime/async.c) is not yet reachable through codegen, so it can't be
// differential-tested. These tests compile async.c together with a small C harness under
// tests/runtime/ and run it — the harness exits non-zero (which execFileSync turns into a throw)
// on any behavioral failure.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CLANG, GC_CFLAGS, GC_LFLAGS } from "../../src/driver/toolchain.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function runCTest(harness: string): void {
  const dir = mkdtempSync(join(tmpdir(), "chad-async-"));
  const bin = join(dir, "t");
  execFileSync(
    CLANG,
    [
      ...GC_CFLAGS,
      join(root, "runtime", "async.c"),
      join(root, "tests", "runtime", harness),
      ...GC_LFLAGS,
      "-o",
      bin,
    ],
    { stdio: "pipe" },
  );
  execFileSync(bin, [], { stdio: "pipe" }); // throws (fails the test) on a non-zero exit
}

test("async runtime: awaiters of one promise resume in FIFO registration order", () => {
  assert.doesNotThrow(() => runCTest("async_fifo_test.c"));
});
