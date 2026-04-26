import { describe, it } from "node:test";
import assert from "node:assert";
import { exec, spawn } from "node:child_process";
import { promisify } from "node:util";
import * as http from "node:http";
import * as net from "node:net";

const execAsync = promisify(exec);

if (!process.env.CHADC_COMPILER) {
  throw new Error(
    "CHADC_COMPILER env var is required. Run via: npm test, npm run test:node, or npm run test:native",
  );
}
const compiler = `${process.env.CHADC_COMPILER} build`;
const isNodeCompiler = process.env.CHADC_COMPILER.includes("chad-node");
const buildDir = process.env.CHADC_BUILD_DIR || ".build";

function getRandomPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

describe("Network Tests", () => {
  it("should perform HTTP requests using fetch() builtin", async () => {
    const server = http.createServer((req, res) => {
      if (req.url === "/test") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("Test response from server\nLine 2\nLine 3");
      } else if (req.url === "/json") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end('{"status": "ok", "message": "JSON response"}');
      } else if (req.url === "/plain") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("Hello from ChadScript test server");
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });

    const port = (server.address() as { port: number }).port;

    try {
      const testFile = "tests/fixtures/network/fetch-integration-test.ts";
      await execAsync(
        `${compiler} ${testFile} -o ${buildDir}/tests/fixtures/network/fetch-integration-test`,
      );

      const { stdout } = await execAsync(
        `${buildDir}/tests/fixtures/network/fetch-integration-test -p ${port}`,
      );

      assert.ok(stdout.includes("TEST_PASSED"), "fetch() integration test should pass");
      assert.ok(!stdout.includes("TEST_FAILED"), "fetch() test should not fail");
    } finally {
      server.close();
    }
  });

  it("should run Promise.all with concurrent fetch() calls", async () => {
    const server = http.createServer((req, res) => {
      if (req.url === "/a") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("response-a");
      } else if (req.url === "/b") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("response-b");
      } else if (req.url === "/c") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("response-c");
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });

    const port = (server.address() as { port: number }).port;

    try {
      const testFile = "tests/fixtures/network/promise-all-fetch-test.ts";
      await execAsync(
        `${compiler} ${testFile} -o ${buildDir}/tests/fixtures/network/promise-all-fetch-test`,
      );
      const { stdout } = await execAsync(
        `${buildDir}/tests/fixtures/network/promise-all-fetch-test -p ${port}`,
      );
      assert.ok(stdout.includes("TEST_PASSED"), "Promise.all + fetch test should pass");
    } finally {
      server.close();
    }
  });

  it("should run async fetch with response.ok and response.text()", async () => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(req.url);
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });

    const port = (server.address() as { port: number }).port;

    try {
      const testFile = "tests/fixtures/network/async-fetch-test.ts";
      await execAsync(
        `${compiler} ${testFile} -o ${buildDir}/tests/fixtures/network/async-fetch-test`,
      );
      const { stdout } = await execAsync(
        `${buildDir}/tests/fixtures/network/async-fetch-test -p ${port}`,
      );
      assert.ok(stdout.includes("TEST_PASSED"), "async fetch test should pass");
    } finally {
      server.close();
    }
  });

  it("should run Promise.all with concurrent slow fetches", async () => {
    const server = http.createServer((req, res) => {
      const delay = 100;
      setTimeout(() => {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end(req.url);
      }, delay);
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });

    const port = (server.address() as { port: number }).port;

    try {
      const testFile = "tests/fixtures/network/promise-all-concurrent.ts";
      await execAsync(
        `${compiler} ${testFile} -o ${buildDir}/tests/fixtures/network/promise-all-concurrent`,
      );
      const { stdout } = await execAsync(
        `${buildDir}/tests/fixtures/network/promise-all-concurrent -p ${port}`,
      );
      assert.ok(stdout.includes("TEST_PASSED"), "Promise.all concurrent test should pass");
    } finally {
      server.close();
    }
  });

  it("should handle JSON.parse<T>() and response.json<T>() with the same type", async () => {
    const server = http.createServer((req, res) => {
      if (req.url === "/item") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end('{"id":2,"name":"fetched"}');
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });

    const port = (server.address() as { port: number }).port;

    try {
      const testFile = "tests/fixtures/network/json-parse-and-response-json-test.ts";
      await execAsync(
        `${compiler} ${testFile} -o ${buildDir}/tests/fixtures/network/json-parse-and-response-json-test`,
      );
      const { stdout } = await execAsync(
        `${buildDir}/tests/fixtures/network/json-parse-and-response-json-test -p ${port}`,
      );
      assert.ok(
        stdout.includes("TEST_PASSED"),
        "JSON.parse + response.json same type test should pass",
      );
    } finally {
      server.close();
    }
  });

  it("should run Promise.race with resolved promises", { skip: isNodeCompiler }, async () => {
    const testFile = "tests/fixtures/network/promise-race-test.ts";
    const exeFile = `${buildDir}/tests/fixtures/network/promise-race-test`;
    await execAsync(`${compiler} ${testFile} -o ${exeFile}`);
    const { stdout } = await execAsync(exeFile);
    assert.ok(stdout.includes("TEST_PASSED"), "Promise.race test should pass");
  });

  it("should run HTTP server using httpServe()", async () => {
    const port = await getRandomPort();
    const testFile = "tests/fixtures/network/http-server-test.ts";
    const serverExe = `${buildDir}/tests/fixtures/network/http-server-test`;
    await execAsync(`${compiler} ${testFile} -o ${serverExe}`);

    const serverProcess = spawn(serverExe, ["-p", String(port)], {
      detached: true,
      stdio: "ignore",
    });

    async function waitForServer(maxMs = 10000): Promise<void> {
      const start = Date.now();
      while (Date.now() - start < maxMs) {
        try {
          await fetch(`http://127.0.0.1:${port}/`);
          return;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
      throw new Error("Server not ready after " + maxMs + "ms");
    }

    await waitForServer();

    try {
      const responses = await Promise.all([
        fetch(`http://127.0.0.1:${port}/`).then((r) => r.text()),
        fetch(`http://127.0.0.1:${port}/json`).then((r) => r.text()),
        fetch(`http://127.0.0.1:${port}/notfound`).then((r) => r.text()),
      ]);

      assert.strictEqual(
        responses[0],
        "Hello from ChadScript!",
        "Root path should return greeting",
      );
      assert.strictEqual(responses[1], '{"ok":true}', "JSON path should return JSON");
      assert.strictEqual(responses[2], "Not Found", "Unknown path should return 404");
    } finally {
      process.kill(-serverProcess.pid!, "SIGTERM");
    }
  });
});
