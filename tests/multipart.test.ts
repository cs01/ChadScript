import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { exec, spawn, ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import * as fsSync from "node:fs";
import * as http from "node:http";

const execAsync = promisify(exec);

const SERVER_SOURCE = "tests/fixtures/network/multipart-test.ts";
const SERVER_BINARY = ".build/tests/fixtures/network/multipart-test";
const PORT = 9987;

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

describe("Multipart Parser Tests", { concurrency: 1 }, () => {
  let serverProcess: ChildProcess | null = null;

  before(async () => {
    await execAsync(`node dist/chad-node.js build ${SERVER_SOURCE}`, {
      timeout: 60000,
    });
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
        const resp = await fetch(`http://127.0.0.1:${PORT}/upload`, {
          method: "POST",
          body: "ping",
        });
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
    return serverProcess;
  }

  it("should parse simple text fields", async () => {
    await startServer();

    const boundary = "----TestBoundary123";
    const body = [
      `------TestBoundary123`,
      `Content-Disposition: form-data; name="username"`,
      ``,
      `john`,
      `------TestBoundary123`,
      `Content-Disposition: form-data; name="email"`,
      ``,
      `john@example.com`,
      `------TestBoundary123--`,
    ].join("\r\n");

    const resp = await fetch(`http://127.0.0.1:${PORT}/upload`, {
      method: "POST",
      headers: {
        "Content-Type": `multipart/form-data; boundary=----TestBoundary123`,
      },
      body,
    });

    const text = await resp.text();
    assert.ok(text.includes("count=2"), `Expected count=2, got: ${text}`);
    assert.ok(
      text.includes("name=username"),
      `Expected name=username in: ${text}`,
    );
    assert.ok(
      text.includes("data=john"),
      `Expected data=john in: ${text}`,
    );
    assert.ok(
      text.includes("name=email"),
      `Expected name=email in: ${text}`,
    );
    assert.ok(
      text.includes("data=john@example.com"),
      `Expected data=john@example.com in: ${text}`,
    );
  });

  it("should parse file uploads with filename and content-type", async () => {
    await startServer();

    const body = [
      `------FileBoundary`,
      `Content-Disposition: form-data; name="file"; filename="test.txt"`,
      `Content-Type: text/plain`,
      ``,
      `Hello World!`,
      `------FileBoundary`,
      `Content-Disposition: form-data; name="description"`,
      ``,
      `A test file`,
      `------FileBoundary--`,
    ].join("\r\n");

    const resp = await fetch(`http://127.0.0.1:${PORT}/upload`, {
      method: "POST",
      headers: {
        "Content-Type": `multipart/form-data; boundary=----FileBoundary`,
      },
      body,
    });

    const text = await resp.text();
    assert.ok(text.includes("count=2"), `Expected count=2, got: ${text}`);
    assert.ok(
      text.includes("filename=test.txt"),
      `Expected filename=test.txt in: ${text}`,
    );
    assert.ok(
      text.includes("contentType=text/plain"),
      `Expected contentType=text/plain in: ${text}`,
    );
    assert.ok(
      text.includes("data=Hello World!"),
      `Expected data=Hello World! in: ${text}`,
    );
    assert.ok(
      text.includes("name=description"),
      `Expected name=description in: ${text}`,
    );
  });
});
