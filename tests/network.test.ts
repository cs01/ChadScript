import { describe, it } from "node:test";
import assert from "node:assert";
import { exec, spawn } from "node:child_process";
import { promisify } from "node:util";
import * as http from "node:http";

const execAsync = promisify(exec);

describe("Network Tests", () => {
  // TCP socket and client tests are static fixtures auto-discovered by compiler.test.ts:
  //   tests/fixtures/network/tcp-test-socket.ts
  //   tests/fixtures/network/tcp-client.ts

  it("should perform HTTP requests using fetch() builtin", async () => {
    // Start a Node.js HTTP server for testing
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
      server.listen(9998, "127.0.0.1", resolve);
    });

    try {
      // Compile the fetch test fixture
      const testFile = "tests/fixtures/network/fetch-integration-test.ts";
      await execAsync(`node dist/chad-node.js build ${testFile}`);

      // Run the compiled program
      const { stdout, stderr } = await execAsync(
        ".build/tests/fixtures/network/fetch-integration-test",
      );

      // Verify the test passed
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
      server.listen(19881, "127.0.0.1", resolve);
    });

    try {
      const testFile = "tests/fixtures/network/promise-all-fetch-test.ts";
      await execAsync(`node dist/chad-node.js build ${testFile}`);
      const { stdout } = await execAsync(".build/tests/fixtures/network/promise-all-fetch-test");
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
      server.listen(19878, "127.0.0.1", resolve);
    });

    try {
      const testFile = "tests/fixtures/network/async-fetch-test.ts";
      await execAsync(`node dist/chad-node.js build ${testFile}`);
      const { stdout } = await execAsync(".build/tests/fixtures/network/async-fetch-test");
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
      server.listen(19880, "127.0.0.1", resolve);
    });

    try {
      const testFile = "tests/fixtures/network/promise-all-concurrent.ts";
      await execAsync(`node dist/chad-node.js build ${testFile}`);
      const { stdout } = await execAsync(".build/tests/fixtures/network/promise-all-concurrent");
      assert.ok(stdout.includes("TEST_PASSED"), "Promise.all concurrent test should pass");
    } finally {
      server.close();
    }
  });

  it("should run Promise.race with resolved promises", async () => {
    const testFile = "tests/fixtures/network/promise-race-test.ts";
    await execAsync(`node dist/chad-node.js build ${testFile}`);
    const { stdout } = await execAsync(".build/tests/fixtures/network/promise-race-test");
    assert.ok(stdout.includes("TEST_PASSED"), "Promise.race test should pass");
  });

  it("should run HTTP server using httpServe() and mongoose", async () => {
    const testFile = "tests/fixtures/network/http-server-test.ts";
    await execAsync(`node dist/chad-node.js build ${testFile}`);

    const serverProcess = spawn(".build/tests/fixtures/network/http-server-test", [], {
      detached: true,
      stdio: "ignore",
    });

    await new Promise((resolve) => setTimeout(resolve, 500));

    try {
      const responses = await Promise.all([
        fetch("http://127.0.0.1:9997/").then((r) => r.text()),
        fetch("http://127.0.0.1:9997/json").then((r) => r.text()),
        fetch("http://127.0.0.1:9997/notfound").then((r) => r.text()),
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
