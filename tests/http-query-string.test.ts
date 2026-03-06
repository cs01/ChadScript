import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { exec, spawn, ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import * as fsSync from "node:fs";

const execAsync = promisify(exec);

const SERVER_SOURCE = "tests/fixtures/network/http-query-string-test.ts";
const SERVER_BINARY = ".build/tests/fixtures/network/http-query-string-test";
const PORT = 9985;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("HTTP Query String Tests", { concurrency: 1 }, () => {
  let serverProcess: ChildProcess | null = null;

  before(async () => {
    await execAsync(`node dist/chad-node.js build ${SERVER_SOURCE}`, { timeout: 60000 });
    assert.ok(fsSync.existsSync(SERVER_BINARY), "Server binary should exist");
  });

  after(async () => {
    if (serverProcess?.pid) {
      try {
        process.kill(-serverProcess.pid, "SIGTERM");
      } catch {}
    }
  });

  async function waitForServer(maxAttempts = 50): Promise<void> {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const resp = await fetch(`http://127.0.0.1:${PORT}/check-path`);
        await resp.text();
        return;
      } catch {
        await sleep(100);
      }
    }
    throw new Error(`Server not ready after ${maxAttempts * 100}ms`);
  }

  async function startServer(): Promise<ChildProcess> {
    if (serverProcess?.pid && isProcessAlive(serverProcess.pid)) {
      try {
        process.kill(-serverProcess.pid, "SIGTERM");
      } catch {}
      await sleep(500);
    }

    serverProcess = spawn(SERVER_BINARY, [], {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    assert.ok(serverProcess.pid, "Server should have a PID");
    await waitForServer();
    assert.ok(isProcessAlive(serverProcess.pid), "Server should be alive after start");

    return serverProcess;
  }

  async function stopServer(): Promise<void> {
    if (serverProcess?.pid) {
      try {
        process.kill(-serverProcess.pid, "SIGTERM");
      } catch {}
      await sleep(500);
      serverProcess = null;
    }
  }

  it("query string is exposed in req.queryString", async () => {
    const srv = await startServer();
    try {
      const resp = await fetch(`http://127.0.0.1:${PORT}/echo-query?foo=bar&baz=qux`);
      const body = await resp.text();
      assert.ok(isProcessAlive(srv.pid!), "Server should be alive");
      assert.strictEqual(body, "foo=bar&baz=qux");
    } finally {
      await stopServer();
    }
  });

  it("path does not include query string", async () => {
    const srv = await startServer();
    try {
      const resp = await fetch(`http://127.0.0.1:${PORT}/check-path?x=1`);
      const body = await resp.text();
      assert.ok(isProcessAlive(srv.pid!), "Server should be alive");
      assert.strictEqual(body, "/check-path");
    } finally {
      await stopServer();
    }
  });

  it("queryString is empty when no query string present", async () => {
    const srv = await startServer();
    try {
      const resp = await fetch(`http://127.0.0.1:${PORT}/echo-query`);
      const body = await resp.text();
      assert.ok(isProcessAlive(srv.pid!), "Server should be alive");
      assert.strictEqual(body, "");
    } finally {
      await stopServer();
    }
  });
});
