// Async-runtime behavior (runtime/async.c) is not yet reachable through codegen, so it can't be
// differential-tested. These tests compile async.c together with a small C harness under
// tests/runtime/ and run it — the harness exits non-zero (which execFileSync turns into a throw)
// on any behavioral failure.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CLANG, GC_CFLAGS, GC_LFLAGS } from "../../src/driver/toolchain.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const runtimeCs = readdirSync(join(root, "runtime"))
  .filter((f) => f.endsWith(".c"))
  .map((f) => join(root, "runtime", f));

// Compile a C harness against the WHOLE runtime (async.c plus the exception/string/etc. runtime a
// rejection test needs — cs_throw & the handler chain live in runtime.c) and run it.
function runCTest(harness: string): void {
  const dir = mkdtempSync(join(tmpdir(), "chad-async-"));
  const bin = join(dir, "t");
  execFileSync(
    CLANG,
    [...GC_CFLAGS, ...runtimeCs, join(root, "tests", "runtime", harness), ...GC_LFLAGS, "-o", bin],
    { stdio: "pipe" },
  );
  execFileSync(bin, [], { stdio: "pipe" }); // throws (fails the test) on a non-zero exit
}

test("async runtime: awaiters of one promise resume in FIFO registration order", () => {
  assert.doesNotThrow(() => runCTest("async_fifo_test.c"));
});

test("async runtime: microtask queue is non-lossy and FIFO past its initial capacity", () => {
  assert.doesNotThrow(() => runCTest("async_queue_test.c"));
});

test("async runtime: a throw escaping a fiber body rejects its result promise", () => {
  assert.doesNotThrow(() => runCTest("async_fiber_throw_test.c"));
});

test("async runtime: awaiting a rejected promise throws into the fiber's try/catch", () => {
  assert.doesNotThrow(() => runCTest("async_reject_test.c"));
});

test("async runtime: concurrent try/catch across await catch their own rejections (fiber-local handler stack)", () => {
  assert.doesNotThrow(() => runCTest("async_concurrent_reject_test.c"));
});

test("async runtime: promise values round-trip through resolve/await for each boxed representation", () => {
  assert.doesNotThrow(() => runCTest("async_boxing_test.c"));
});
