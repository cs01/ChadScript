import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { exec, spawn, ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import * as fsSync from "node:fs";
import * as http from "node:http";
import * as net from "node:net";

const execAsync = promisify(exec);

if (!process.env.CHADC_COMPILER) {
  throw new Error(
    "CHADC_COMPILER env var is required. Run via: npm test, npm run test:node, or npm run test:native",
  );
}
const compiler = `${process.env.CHADC_COMPILER} build`;
const buildDir = process.env.CHADC_BUILD_DIR || ".build";

const SERVER_SOURCE = "tests/fixtures/network/http-headers-test.ts";
const SERVER_BINARY = `${buildDir}/tests/fixtures/network/http-headers-test`;
let PORT = 0;

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

describe("HTTP Headers Tests", { concurrency: 1 }, () => {
  let serverProcess: ChildProcess | null = null;

  before(async () => {
    PORT = await new Promise<number>((resolve, reject) => {
      const srv = net.createServer();
      srv.listen(0, "127.0.0.1", () => {
        const p = (srv.address() as net.AddressInfo).port;
        srv.close(() => resolve(p));
      });
      srv.on("error", reject);
    });
    await execAsync(`${compiler} ${SERVER_SOURCE} -o ${SERVER_BINARY}`, { timeout: 60000 });
    assert.ok(fsSync.existsSync(SERVER_BINARY), "Server binary should exist");
  });

  after(async () => {
    if (serverProcess?.pid) {
      try {
        process.kill(-serverProcess.pid, "SIGTERM");
      } catch {}
    }
  });

  async function waitForServer(maxAttempts = 100): Promise<void> {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const resp = await fetch(`http://127.0.0.1:${PORT}/custom-ct`);
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

    serverProcess = spawn(SERVER_BINARY, ["-p", String(PORT)], {
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

  // Helper that uses Node's http module to get raw headers
  async function rawRequest(
    path: string,
    reqHeaders?: Record<string, string>,
  ): Promise<{ headers: http.IncomingHttpHeaders; body: string; statusCode: number }> {
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port: PORT,
          path,
          method: "GET",
          headers: reqHeaders,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () =>
            resolve({
              headers: res.headers,
              body: Buffer.concat(chunks).toString("utf-8"),
              statusCode: res.statusCode ?? 0,
            }),
          );
        },
      );
      req.on("error", reject);
      req.end();
    });
  }

  it("Content-Type override via headers field", async () => {
    const srv = await startServer();
    try {
      const { headers, body } = await rawRequest("/custom-ct");
      assert.ok(isProcessAlive(srv.pid!), "Server should be alive");
      assert.strictEqual(headers["content-type"], "application/json");
      assert.strictEqual(body, '{"data":true}');
    } finally {
      await stopServer();
    }
  });

  it("Set-Cookie header in response", async () => {
    const srv = await startServer();
    try {
      const { headers } = await rawRequest("/set-cookie");
      assert.ok(isProcessAlive(srv.pid!), "Server should be alive");
      assert.ok(
        headers["set-cookie"]?.toString().includes("session=abc123"),
        `Expected Set-Cookie to contain session=abc123, got: ${headers["set-cookie"]}`,
      );
    } finally {
      await stopServer();
    }
  });

  it("Multiple custom headers in response", async () => {
    const srv = await startServer();
    try {
      const { headers } = await rawRequest("/multi-header");
      assert.ok(isProcessAlive(srv.pid!), "Server should be alive");
      assert.strictEqual(headers["x-custom"], "hello");
      assert.strictEqual(headers["x-another"], "world");
    } finally {
      await stopServer();
    }
  });

  it("Request headers accessible in handler", async () => {
    const srv = await startServer();
    try {
      const { body } = await rawRequest("/echo-headers", {
        "X-Test-Header": "test-value",
        Cookie: "foo=bar",
      });
      assert.ok(isProcessAlive(srv.pid!), "Server should be alive");
      assert.ok(
        body.includes("X-Test-Header") || body.includes("x-test-header"),
        `Expected request headers to contain X-Test-Header, got: ${body.substring(0, 200)}`,
      );
      assert.ok(
        body.includes("test-value"),
        `Expected request headers to contain test-value, got: ${body.substring(0, 200)}`,
      );
    } finally {
      await stopServer();
    }
  });

  it("Empty headers field works (backwards compat)", async () => {
    const srv = await startServer();
    try {
      const { statusCode, body } = await rawRequest("/nonexistent");
      assert.ok(isProcessAlive(srv.pid!), "Server should be alive");
      assert.strictEqual(statusCode, 404);
      assert.strictEqual(body, "Not Found");
    } finally {
      await stopServer();
    }
  });
});
