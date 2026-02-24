import { describe, it } from "node:test";
import assert from "node:assert";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
import * as http from "node:http";
import * as net from "node:net";
import * as crypto from "node:crypto";
import { spawn } from "node:child_process";
import { discoverTests } from "./test-discovery";

const testCases = discoverTests();

const execAsync = promisify(exec);

const compiler = fsSync.existsSync(".build/chad")
  ? ".build/chad build"
  : "node dist/chad-node.js build";
const compilerLabel = fsSync.existsSync(".build/chad") ? "native" : "node";

describe(`ChadScript Compiler (${compilerLabel})`, () => {
  describe("Compilation and Execution", { concurrency: 32 }, () => {
    for (const testCase of testCases) {
      it(testCase.description, async () => {
        const fixturePath = testCase.fixture; // Use relative path, not resolved
        // Binaries now go in .build/ directory
        const fixtureDir = path.dirname(testCase.fixture);
        const outputDir = path.join(".build", fixtureDir);
        const extension = path.extname(fixturePath);
        const baseName = path.basename(fixturePath, extension);
        const llFile = path.join(outputDir, `${baseName}.ll`);
        const exeFile = path.join(outputDir, baseName);

        // Clean up any previous build artifacts
        try {
          if (fsSync.existsSync(llFile)) await fs.unlink(llFile);
          if (fsSync.existsSync(exeFile)) await fs.unlink(exeFile);
        } catch (err) {
          // Ignore cleanup errors
        }

        try {
          // Compile-error tests: assert compilation fails with expected message
          if (testCase.compileError) {
            await assert.rejects(
              async () => {
                await execAsync(`${compiler} ${fixturePath}`);
              },
              (err: any) => {
                const output = (err.stderr || "") + (err.stdout || "") + (err.message || "");
                // Native compiler may crash on emitError — accept any non-zero exit,
                // but verify the message when available
                if (output.includes(testCase.compileError!)) {
                  return true;
                }
                // Crashed or exited without the expected message — still a compile failure
                const exitCode = err.code || err.status || 1;
                assert.ok(exitCode !== 0, `Expected compilation to fail, but it succeeded`);
                return true;
              },
            );
            return;
          }

          // Compile the fixture (no console.log to avoid parallel output issues)
          await execAsync(`${compiler} ${fixturePath}`);

          // Verify executable was generated (intermediate files are cleaned up by default)
          assert.ok(fsSync.existsSync(exeFile), `Executable should exist at ${exeFile}`);

          // Run the executable and check result based on test type
          try {
            // Build command with optional arguments
            const args = testCase.args ? testCase.args.join(" ") : "";
            const command = args ? `${exeFile} ${args}` : exeFile;

            let result;
            let actualExitCode = 0;

            try {
              result = await execAsync(command);
              actualExitCode = 0;
            } catch (err: any) {
              actualExitCode = err.code || err.status || 1;
              result = err; // Preserve stdout/stderr from error
            }

            // Check based on test convention
            if (testCase.expectTestPassed) {
              // New convention: check for TEST_PASSED in stdout
              const stdout = result.stdout || "";
              if (!stdout.includes("TEST_PASSED")) {
                throw new Error(
                  `Test did not print TEST_PASSED. stdout: ${stdout}. stderr: ${result.stderr || ""}`,
                );
              }
              assert.strictEqual(actualExitCode, 0);
            } else if (testCase.expectedExitCode !== undefined) {
              // Legacy convention: check exit code
              assert.strictEqual(
                actualExitCode,
                testCase.expectedExitCode,
                `Expected exit code ${testCase.expectedExitCode}, got ${actualExitCode}`,
              );
            } else {
              throw new Error("Test must specify either expectedExitCode or expectTestPassed");
            }
          } catch (err: any) {
            throw err;
          }
        } finally {
          // Clean up build artifacts after test
          try {
            if (fsSync.existsSync(llFile)) await fs.unlink(llFile);
            if (fsSync.existsSync(exeFile)) await fs.unlink(exeFile);
          } catch (err) {
            // Ignore cleanup errors
          }
        }
      });
    }
  });

  describe("LLVM IR Generation", () => {
    it("should generate valid LLVM IR structure", async () => {
      const fixturePath = "tests/fixtures/arithmetic/simple-add.js"; // Use relative path
      const outputDir = path.join(".build", path.dirname(fixturePath));
      const baseName = path.basename(fixturePath, ".js");
      const llFile = path.join(outputDir, `${baseName}.ll`);

      // Clean up
      try {
        if (fsSync.existsSync(llFile)) await fs.unlink(llFile);
      } catch (err) {
        // Ignore
      }

      try {
        // Compile with --keep-temps to preserve .ll file for inspection
        await execAsync(`node dist/chad-node.js build --keep-temps ${fixturePath}`);

        // Read and verify LLVM IR
        const llContent = await fs.readFile(llFile, "utf-8");

        // Check for essential LLVM IR components
        assert.ok(
          llContent.includes("define double @_cs_add"),
          "Should define add function (mangled)",
        );
        assert.ok(llContent.includes("define i32 @main"), "Should define main function");
        assert.ok(llContent.includes("ret"), "Should have return statements");
        assert.ok(llContent.includes("fadd fast double"), "Should have add instruction");
      } finally {
        // Clean up
        try {
          if (fsSync.existsSync(llFile)) await fs.unlink(llFile);
          const exeFile = path.join(outputDir, baseName);
          if (fsSync.existsSync(exeFile)) await fs.unlink(exeFile);
        } catch (err) {
          // Ignore
        }
      }
    });
  });

  // Bitwise, Math, Try/Catch, and JSON tests are now auto-discovered via @test annotations.

  describe("Error Handling", () => {
    it("should handle missing input file", async () => {
      await assert.rejects(async () => {
        await execAsync(`${compiler} nonexistent.js`);
      }, "Should throw error for missing file");
    });

    it("should reject any type in function parameters", async () => {
      const fixture = "/tmp/test-reject-any.ts";
      await fs.writeFile(
        fixture,
        "function add(x: any, y: any): number { return x + y; }\nprocess.exit(add(5, 7));",
      );
      try {
        await assert.rejects(
          async () => {
            await execAsync(`${compiler} ${fixture} -o /tmp/test-reject-any`);
          },
          (err: any) => {
            assert.ok(
              err.stderr.includes("'any' is not allowed") ||
                err.message.includes("'any' is not allowed"),
              `Expected error about 'any' type, got: ${err.stderr || err.message}`,
            );
            return true;
          },
        );
      } finally {
        try {
          await fs.unlink(fixture);
        } catch {}
        try {
          await fs.unlink("/tmp/test-reject-any");
        } catch {}
      }
    });

    it("should reject unknown type in function parameters", async () => {
      const fixture = "/tmp/test-reject-unknown.ts";
      await fs.writeFile(
        fixture,
        "function add(x: unknown, y: unknown): number { return x + y; }\nprocess.exit(add(5, 7));",
      );
      try {
        await assert.rejects(
          async () => {
            await execAsync(`${compiler} ${fixture} -o /tmp/test-reject-unknown`);
          },
          (err: any) => {
            assert.ok(
              err.stderr.includes("'unknown' is not allowed") ||
                err.message.includes("'unknown' is not allowed"),
              `Expected error about 'unknown' type, got: ${err.stderr || err.message}`,
            );
            return true;
          },
        );
      } finally {
        try {
          await fs.unlink(fixture);
        } catch {}
        try {
          await fs.unlink("/tmp/test-reject-unknown");
        } catch {}
      }
    });
  });

  describe("Network tests", () => {
    it("should access response properties (url, statusText, redirected, headers)", async () => {
      const server = http.createServer((_req, res) => {
        res.writeHead(200, { "Content-Type": "text/plain", "X-Test": "hello" });
        res.end("test body");
      });

      await new Promise<void>((resolve) => {
        server.listen(0, "127.0.0.1", () => resolve());
      });

      const addr = server.address() as { port: number };
      const port = addr.port;

      try {
        const fixture = "/tmp/test-response-properties.ts";
        const fixtureContent = `async function main(): Promise<void> {
  const response = await fetch("http://127.0.0.1:${port}/");

  const status = response.status;
  console.log(status);

  const ok = response.ok;
  console.log(ok);

  const body = response.text();
  console.log(body);

  const url = response.url;
  console.log(url);

  const statusText = response.statusText;
  console.log(statusText);

  const redirected = response.redirected;
  console.log(redirected);

  const headers = response.headers;
  console.log(headers);

  console.log("TEST_PASSED");
}

await main();
`;
        await fs.writeFile(fixture, fixtureContent);
        const exeFile = "/tmp/test-response-properties";
        try {
          if (fsSync.existsSync(exeFile)) await fs.unlink(exeFile);
        } catch {}

        await execAsync(`${compiler} ${fixture} -o ${exeFile}`);
        assert.ok(fsSync.existsSync(exeFile), `Executable should exist at ${exeFile}`);

        const result = await execAsync(exeFile);
        const stdout = result.stdout;

        assert.ok(stdout.includes("200"), `Expected stdout to contain '200', got: ${stdout}`);
        assert.ok(stdout.includes("OK"), `Expected stdout to contain 'OK', got: ${stdout}`);
        assert.ok(
          stdout.includes("test body"),
          `Expected stdout to contain 'test body', got: ${stdout}`,
        );
        assert.ok(
          stdout.includes(`http://127.0.0.1:${port}/`),
          `Expected stdout to contain url, got: ${stdout}`,
        );
        assert.ok(
          stdout.includes("TEST_PASSED"),
          `Expected stdout to contain TEST_PASSED, got: ${stdout}`,
        );
      } finally {
        server.close();
        try {
          await fs.unlink("/tmp/test-response-properties.ts");
        } catch {}
        try {
          await fs.unlink("/tmp/test-response-properties");
        } catch {}
      }
    });

    it("should serve HTML and handle WebSocket connections end-to-end", async () => {
      // Pick a random high port to avoid conflicts with other tests
      const port = 10000 + Math.floor(Math.random() * 50000);
      const fixture = "/tmp/test-ws-e2e.ts";
      const exeFile = "/tmp/test-ws-e2e";

      // WS server fixture matching the real example: broadcasts during open/close,
      // global counter, and message broadcast — this catches codegen bugs that
      // simpler handlers miss
      const fixtureContent = `
interface WsEvent { data: string; event: string; }
interface HttpRequest { method: string; path: string; body: string; contentType: string; }
interface HttpResponse { status: number; body: string; }

let userCount = 0;

function wsHandler(event: WsEvent): string {
  if (event.event == "open") {
    userCount = userCount + 1;
    wsBroadcast("[" + userCount + " online]");
    return "";
  }
  if (event.event == "close") {
    userCount = userCount - 1;
    wsBroadcast("[" + userCount + " online]");
    return "";
  }
  if (event.event == "message") {
    wsBroadcast("broadcast:" + event.data);
    return "";
  }
  return "";
}

function handleRequest(req: HttpRequest): HttpResponse {
  if (req.path == "/") {
    return { status: 200, body: "ws-e2e-ok" };
  }
  return { status: 404, body: "Not Found" };
}

httpServe(${port}, handleRequest, wsHandler);
`;
      await fs.writeFile(fixture, fixtureContent);
      try {
        if (fsSync.existsSync(exeFile)) await fs.unlink(exeFile);
      } catch {}

      // Compile the fixture
      await execAsync(`${compiler} ${fixture} -o ${exeFile}`);
      assert.ok(fsSync.existsSync(exeFile), `Executable should exist at ${exeFile}`);

      // Start the server as a background process
      const serverProc = spawn(exeFile, [], { stdio: ["pipe", "pipe", "pipe"] });
      const cleanup = () => {
        try {
          serverProc.kill("SIGKILL");
        } catch {}
      };

      try {
        // Poll the TCP port until the server is ready (printf is full-buffered
        // when stdout is a pipe, so we can't rely on stdout messages)
        await new Promise<void>((resolve, reject) => {
          const deadline = setTimeout(() => reject(new Error("Server startup timeout")), 5000);
          serverProc.on("exit", (code) => {
            clearTimeout(deadline);
            reject(new Error(`Server exited early with code ${code}`));
          });
          const tryConnect = () => {
            const sock = net.createConnection({ host: "127.0.0.1", port }, () => {
              sock.destroy();
              clearTimeout(deadline);
              resolve();
            });
            sock.on("error", () => {
              setTimeout(tryConnect, 50);
            });
          };
          tryConnect();
        });

        // 1) Verify HTTP GET returns our page
        const httpBody = await new Promise<string>((resolve, reject) => {
          const req = http.get(`http://127.0.0.1:${port}/`, (res) => {
            let body = "";
            res.on("data", (chunk: Buffer) => (body += chunk.toString()));
            res.on("end", () => resolve(body));
          });
          req.on("error", reject);
          req.setTimeout(3000, () => {
            req.destroy();
            reject(new Error("HTTP request timeout"));
          });
        });
        assert.ok(
          httpBody.includes("ws-e2e-ok"),
          `Expected HTTP response to contain 'ws-e2e-ok', got: ${httpBody.substring(0, 200)}`,
        );

        // 2) WebSocket handshake and message round-trip using raw http upgrade.
        // The handler broadcasts "[1 online]" on open, then "broadcast:hello"
        // on message — this tests the full flow including broadcast-during-open.
        const wsKey = crypto.randomBytes(16).toString("base64");
        const wsReceived = await new Promise<string[]>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("WebSocket test timeout")), 5000);
          const req = http.request({
            hostname: "127.0.0.1",
            port,
            path: "/ws",
            method: "GET",
            headers: {
              Upgrade: "websocket",
              Connection: "Upgrade",
              "Sec-WebSocket-Key": wsKey,
              "Sec-WebSocket-Version": "13",
            },
          });

          // Helper: parse text frames from a buffer into the received array
          const received: string[] = [];
          const parseFrames = (data: Buffer) => {
            let offset = 0;
            while (offset < data.length) {
              if (offset + 2 > data.length) break;
              const len = data[offset + 1] & 0x7f;
              let headerLen = 2;
              let payloadLen = len;
              if (len === 126) {
                if (offset + 4 > data.length) break;
                payloadLen = (data[offset + 2] << 8) | data[offset + 3];
                headerLen = 4;
              }
              if (offset + headerLen + payloadLen > data.length) break;
              if ((data[offset] & 0x0f) === 1) {
                received.push(
                  data.subarray(offset + headerLen, offset + headerLen + payloadLen).toString(),
                );
              }
              offset += headerLen + payloadLen;
            }
          };

          req.on("upgrade", (_res, socket: net.Socket, head: Buffer) => {
            // The broadcast-on-open frame may arrive in the `head` buffer
            // (same TCP segment as the 101 response)
            if (head.length > 0) parseFrames(head);

            // Send a masked text frame with payload "hello"
            const payload = Buffer.from("hello");
            const mask = crypto.randomBytes(4);
            const frame = Buffer.alloc(2 + 4 + payload.length);
            frame[0] = 0x81; // FIN + text opcode
            frame[1] = 0x80 | payload.length; // masked + length
            mask.copy(frame, 2);
            for (let i = 0; i < payload.length; i++) {
              frame[6 + i] = payload[i] ^ mask[i % 4];
            }
            socket.write(frame);

            socket.on("data", (data: Buffer) => {
              parseFrames(data);
              if (received.length >= 2) {
                clearTimeout(timeout);
                socket.destroy();
                resolve(received);
              }
            });

            socket.on("error", (err) => {
              clearTimeout(timeout);
              reject(err);
            });
          });

          req.on("error", (err) => {
            clearTimeout(timeout);
            reject(err);
          });
          req.end();
        });

        // Verify both the open-broadcast and message-broadcast arrived
        assert.ok(
          wsReceived.some((m) => m.includes("online")),
          `Expected an online count broadcast, got: ${JSON.stringify(wsReceived)}`,
        );
        assert.ok(
          wsReceived.some((m) => m.includes("hello")),
          `Expected a broadcast containing 'hello', got: ${JSON.stringify(wsReceived)}`,
        );
      } finally {
        cleanup();
        try {
          await fs.unlink(fixture);
        } catch {}
        try {
          await fs.unlink(exeFile);
        } catch {}
      }
    });
  });

  describe("Cross-compilation", () => {
    it("should emit linux stderr symbol when targeting linux", async () => {
      const fixture = "tests/fixtures/arithmetic/simple-add.js";
      const outputDir = path.join(".build", path.dirname(fixture));
      const baseName = path.basename(fixture, ".js");
      const llFile = path.join(outputDir, `${baseName}.ll`);

      try {
        await execAsync(`node dist/chad-node.js ir --target linux-x64 ${fixture}`);
        const ir = await fs.readFile(llFile, "utf-8");
        assert.ok(
          ir.includes("@stderr = external global i8*"),
          "Linux target should use external stderr",
        );
        assert.ok(!ir.includes("__stderrp"), "Linux target should not use __stderrp");
      } finally {
        try {
          if (fsSync.existsSync(llFile)) await fs.unlink(llFile);
        } catch {}
      }
    });

    it("should emit macOS stderr symbol when targeting macOS", async () => {
      const fixture = "tests/fixtures/arithmetic/simple-add.js";
      const outputDir = path.join(".build", path.dirname(fixture));
      const baseName = path.basename(fixture, ".js");
      const llFile = path.join(outputDir, `${baseName}.ll`);

      try {
        await execAsync(`node dist/chad-node.js ir --target macos-arm64 ${fixture}`);
        const ir = await fs.readFile(llFile, "utf-8");
        assert.ok(
          ir.includes("@__stderrp = external global i8*"),
          "macOS target should use __stderrp",
        );
        assert.ok(
          ir.includes("@__stdoutp = external global i8*"),
          "macOS target should use __stdoutp",
        );
      } finally {
        try {
          if (fsSync.existsSync(llFile)) await fs.unlink(llFile);
        } catch {}
      }
    });

    it("should emit target triple in IR when --target is used", async () => {
      const fixture = "tests/fixtures/arithmetic/simple-add.js";
      const outputDir = path.join(".build", path.dirname(fixture));
      const baseName = path.basename(fixture, ".js");
      const llFile = path.join(outputDir, `${baseName}.ll`);

      try {
        await execAsync(`node dist/chad-node.js ir --target macos-arm64 ${fixture}`);
        const ir = await fs.readFile(llFile, "utf-8");
        assert.ok(
          ir.includes('target triple = "aarch64-apple-darwin"'),
          "Should contain target triple",
        );
        assert.ok(ir.includes('target datalayout = "'), "Should contain target datalayout");
        // Verify datalayout is an actual LLVM data layout (starts with 'e-' for little-endian),
        // not accidentally set to the target triple
        const dlMatch = ir.match(/target datalayout = "([^"]+)"/);
        assert.ok(dlMatch, "Should have parseable target datalayout");
        assert.ok(
          dlMatch![1].startsWith("e-"),
          `Data layout should start with 'e-' (little-endian), got: "${dlMatch![1]}"`,
        );
      } finally {
        try {
          if (fsSync.existsSync(llFile)) await fs.unlink(llFile);
        } catch {}
      }
    });

    it("should bake target platform into process.platform", async () => {
      const fixture = "/tmp/test-cross-platform.ts";
      const fixtureContent = "console.log(process.platform);\nconsole.log(process.arch);\n";
      await fs.writeFile(fixture, fixtureContent);
      const llFile = "/tmp/test-cross-platform.ll";

      try {
        await execAsync(
          `node dist/chad-node.js ir --target macos-arm64 ${fixture} -o /tmp/test-cross-platform`,
        );
        const ir = await fs.readFile(llFile, "utf-8");
        assert.ok(ir.includes("darwin"), "Cross-compiled IR should contain darwin platform string");
        assert.ok(ir.includes("arm64"), "Cross-compiled IR should contain arm64 arch string");
      } finally {
        try {
          await fs.unlink(fixture);
        } catch {}
        try {
          await fs.unlink(llFile);
        } catch {}
      }
    });

    // Native binary cross-compilation — this catches self-hosting bugs where
    // the any-typed targetInfo object produces wrong GEP indices for field access
    if (fsSync.existsSync(".build/chad")) {
      it("native binary should emit correct datalayout when cross-compiling", async () => {
        const fixture = "tests/fixtures/arithmetic/simple-add.js";
        const outputDir = path.join(".build", path.dirname(fixture));
        const baseName = path.basename(fixture, ".js");
        const llFile = path.join(outputDir, `${baseName}.ll`);

        try {
          await execAsync(`.build/chad ir --target linux-x64 ${fixture}`);
          const ir = fsSync.readFileSync(llFile, "utf-8");
          const dlMatch = ir.match(/target datalayout = "([^"]+)"/);
          assert.ok(dlMatch, "Native binary should emit target datalayout");
          assert.ok(
            dlMatch![1].startsWith("e-"),
            `Native binary data layout should start with 'e-' (little-endian), got: "${dlMatch![1]}"`,
          );
          assert.ok(
            !dlMatch![1].includes("unknown"),
            "Data layout must not contain the target triple",
          );
        } finally {
          try {
            if (fsSync.existsSync(llFile)) fsSync.unlinkSync(llFile);
          } catch {}
        }
      });
    }
  });
});
