// The `chad` command line: `run --fallback=node` (a rejected program runs under Node with the same
// arguments and exit code; an accepted one still runs natively), `--version`, and `doctor` (its
// failure report, and a full pass on a machine that has the toolchain).

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const chad = join(root, "bin", "chad");
const outOfSubset = join(root, "tests", "cli", "out-of-subset.ts");
const inSubset = join(root, "tests", "cli", "in-subset.ts");

function chadRun(args: string[], env: NodeJS.ProcessEnv = process.env) {
  const r = spawnSync(chad, args, { encoding: "utf8", env, timeout: 600_000 });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

test("run --fallback=node: a rejected program prints its diagnostics, then runs under node", () => {
  const r = chadRun(["run", "--fallback=node", outOfSubset, "a", "b"]);
  assert.equal(r.stdout, "color 1 args a,b\n");
  assert.equal(r.status, 3);
  assert.match(r.stderr, /error\[CS1202\]: `enum` is not supported/);
  assert.match(r.stderr, /running the program under node instead/);
});

test("run without --fallback: a rejected program is only reported", () => {
  const r = chadRun(["run", outOfSubset, "a"]);
  assert.equal(r.stdout, "");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /error\[CS1202\]/);
});

test("run --fallback=node: an accepted program runs natively", () => {
  const r = chadRun(["run", "--fallback=node", inSubset, "x", "y"]);
  assert.equal(r.stdout, "native x,y\n");
  assert.equal(r.status, 4);
  assert.doesNotMatch(r.stderr, /under node/);
});

test("run: an unknown option and a missing file are usage errors", () => {
  assert.equal(chadRun(["run", "--fallback=deno", inSubset]).status, 2);
  const missing = chadRun(["run", join(root, "tests", "cli", "absent.ts")]);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /no such file/);
});

test("--version prints the package version and the pinned Milo commit", () => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string };
  const pin = /MILO_COMMIT="([0-9a-f]{40})"/.exec(
    readFileSync(join(root, "scripts", "milo-pin.sh"), "utf8"),
  )![1];
  const r = chadRun(["--version"]);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, `chad ${pkg.version} (milo ${pin})\n`);
});

test("doctor reports a missing tool with its fix and skips the hello world", () => {
  const r = chadRun(["doctor"], { ...process.env, CHAD_CLANG: "/nonexistent/clang" });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /FAIL {2}clang +`\/nonexistent\/clang` not found/);
  assert.match(r.stdout, /fix: CHAD_CLANG is set to/);
  assert.match(r.stdout, /FAIL {2}hello world +skipped/);
});

test("doctor passes on a machine with the toolchain", () => {
  const r = chadRun(["doctor"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /ok {4}hello world +compiled and ran/);
  assert.match(r.stdout, /all checks passed/);
});
