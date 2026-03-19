// e2e test for `chad watch` — verifies the file watcher detects changes,
// recompiles, and re-runs the binary automatically.

import { describe, it } from "node:test";
import assert from "node:assert";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

if (!process.env.CHADC_COMPILER) {
  throw new Error(
    "CHADC_COMPILER env var is required. Run via: npm test, npm run test:node, or npm run test:native",
  );
}
const compiler = process.env.CHADC_COMPILER;

describe("chad watch", { timeout: 30000 }, () => {
  it("should recompile and re-run on file change", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chad-watch-"));
    const sourceFile = path.join(tmpDir, "watch-test.ts");

    // Write initial source
    fs.writeFileSync(sourceFile, 'console.log("VERSION_1");\nprocess.exit(0);\n');

    // Start the watcher
    const args = compiler.startsWith("node")
      ? [compiler.split(" ")[1], "watch", sourceFile]
      : ["watch", sourceFile];
    const bin = compiler.startsWith("node") ? "node" : compiler;

    const watchProc = spawn(bin, args, {
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    watchProc.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });
    watchProc.stderr.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    // Wait for initial compile + run
    await waitForOutput(() => stdout, "VERSION_1", 15000);

    // Modify the source file — watcher should detect and recompile
    fs.writeFileSync(sourceFile, 'console.log("VERSION_2");\nprocess.exit(0);\n');

    // Wait for recompile + re-run
    await waitForOutput(() => stdout, "VERSION_2", 10000);

    // Clean up
    watchProc.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      watchProc.on("exit", () => resolve());
      setTimeout(resolve, 2000);
    });

    assert.ok(stdout.includes("VERSION_1"), "should have run initial version");
    assert.ok(stdout.includes("VERSION_2"), "should have recompiled and run after file change");

    try {
      fs.rmSync(tmpDir, { recursive: true });
    } catch {
      // ignore cleanup errors
    }
  });
});

function waitForOutput(getOutput: () => string, needle: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (getOutput().includes(needle)) {
        resolve();
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`Timed out waiting for "${needle}" in output.\nGot: ${getOutput()}`));
        return;
      }
      setTimeout(check, 200);
    };
    check();
  });
}
