// The differential harness must tell a normal exit apart from a crash (signal) and a hang
// (timeout). A native segfault used to be collapsed into `exit: 1`, which could falsely match
// Node's exit 1 — these tests pin the classification that prevents that.

import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "../harness/differential.js";

test("normal exit reports its code, no signal", async () => {
  const r = await run("sh", ["-c", "printf hi; exit 3"]);
  assert.equal(r.stdout, "hi");
  assert.equal(r.exit, 3);
  assert.equal(r.signal, null);
  assert.equal(r.timedOut, false);
});

test("exit 0 is normal", async () => {
  const r = await run("sh", ["-c", "printf ok"]);
  assert.equal(r.exit, 0);
  assert.equal(r.signal, null);
});

test("a signal death is a crash, not an exit code", async () => {
  const r = await run("sh", ["-c", "kill -SEGV $$"]);
  assert.equal(r.signal, "SIGSEGV");
  assert.equal(r.exit, null); // crucially NOT a number — cannot be mistaken for a matching exit
  assert.equal(r.timedOut, false);
});

test("a run that exceeds the timeout is a hang", async () => {
  const r = await run("sh", ["-c", "sleep 5"], 200);
  assert.equal(r.timedOut, true);
  assert.equal(r.signal, null); // a timeout is a hang, distinct from a crash
});
