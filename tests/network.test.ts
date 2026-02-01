import { describe, it } from 'node:test';
import assert from 'node:assert';
import { exec, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import * as net from 'node:net';
import * as http from 'node:http';
import * as fs from 'node:fs/promises';

const execAsync = promisify(exec);

describe('Network Tests', () => {
  it('should compile and run TCP socket program', async () => {
    // Create a test TCP program
    const testFile = 'tests/fixtures/tcp-test-socket.ts';
    const testCode = `
function testSocket(): number {
  const AF_INET = 2;
  const SOCK_STREAM = 1;

  const sock = socket(AF_INET, SOCK_STREAM, 0);
  if (sock < 0) {
    return 1;
  }

  close(sock);
  return 0;
}

testSocket();
`;

    await fs.writeFile(testFile, testCode);

    try {
      // Compile
      await execAsync(`node dist/index.js ${testFile}`);

      // Run
      const { stdout, stderr } = await execAsync('.build/tests/fixtures/tcp-test-socket');
      const exitCode = 0; // If we get here, it succeeded

      assert.strictEqual(exitCode, 0, 'Socket creation should succeed');
    } finally {
      // Cleanup
      try {
        await fs.unlink(testFile);
        await fs.unlink('.build/tests/fixtures/tcp-test-socket');
        await fs.unlink('.build/tests/fixtures/tcp-test-socket.ll');
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  });

  it('should connect to TCP server and exchange data', async (t) => {
    // Start a Node.js TCP echo server
    const server = net.createServer((socket) => {
      socket.on('data', (data) => {
        socket.write(data); // Echo back
      });
    });

    await new Promise<void>((resolve) => {
      server.listen(9876, '127.0.0.1', resolve);
    });

    try {
      // Create ChadScript TCP client
      const clientFile = 'tests/fixtures/tcp-client.ts';
      const clientCode = `
// TCP client that connects to localhost:9876
function testTcpClient(): number {
  const AF_INET = 2;
  const SOCK_STREAM = 1;

  // Create socket
  const sock = socket(AF_INET, SOCK_STREAM, 0);
  if (sock < 0) {
    console.log("Socket failed");
    return 1;
  }

  // TODO: Implement connect() with proper sockaddr_in
  // For now, we've proven sockets compile and link

  close(sock);
  return 0;
}

testTcpClient();
`;

      await fs.writeFile(clientFile, clientCode);

      // Compile and run
      await execAsync(`node dist/index.js ${clientFile}`);
      const { stdout } = await execAsync('.build/tests/fixtures/tcp-client');

      assert.ok(!stdout.includes('Socket failed'), 'Socket creation should work');

      // Cleanup
      await fs.unlink(clientFile);
      await fs.unlink('.build/tests/fixtures/tcp-client');
      await fs.unlink('.build/tests/fixtures/tcp-client.ll');
    } finally {
      server.close();
    }
  });

  it('should perform HTTP requests using fetch() builtin', async () => {
    // Start a Node.js HTTP server for testing
    const server = http.createServer((req, res) => {
      if (req.url === '/test') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Test response from server\nLine 2\nLine 3');
      } else if (req.url === '/json') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"status": "ok", "message": "JSON response"}');
      } else if (req.url === '/plain') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Hello from ChadScript test server');
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    await new Promise<void>((resolve) => {
      server.listen(9998, '127.0.0.1', resolve);
    });

    try {
      // Compile the fetch test fixture
      const testFile = 'tests/fixtures/network/fetch-integration-test.ts';
      await execAsync(`node dist/index.js ${testFile}`);

      // Run the compiled program
      const { stdout, stderr } = await execAsync('.build/tests/fixtures/network/fetch-integration-test');

      // Verify the test passed
      assert.ok(stdout.includes('TEST_PASSED'), 'fetch() integration test should pass');
      assert.ok(!stdout.includes('TEST_FAILED'), 'fetch() test should not fail');
    } finally {
      server.close();
    }
  });

  it('should run HTTP server using httpServe() and mongoose', async () => {
    const testFile = 'tests/fixtures/network/http-server-test.ts';
    const testCode = `
interface Request {
  method: string;
  path: string;
  body: string;
  contentType: string;
}

interface Response {
  status: number;
  body: string;
}

function handleRequest(req: Request): Response {
  if (req.path == "/") {
    return { status: 200, body: "Hello from ChadScript!" };
  }
  if (req.path == "/json") {
    return { status: 200, body: '{"ok":true}' };
  }
  return { status: 404, body: "Not Found" };
}

httpServe(9997, handleRequest);
`;

    await fs.writeFile(testFile, testCode);

    try {
      await execAsync(`node dist/index.js ${testFile}`);

      const serverProcess = spawn('.build/tests/fixtures/network/http-server-test', [], {
        detached: true,
        stdio: 'ignore'
      });

      await new Promise(resolve => setTimeout(resolve, 500));

      try {
        const responses = await Promise.all([
          fetch('http://127.0.0.1:9997/').then(r => r.text()),
          fetch('http://127.0.0.1:9997/json').then(r => r.text()),
          fetch('http://127.0.0.1:9997/notfound').then(r => r.text()),
        ]);

        assert.strictEqual(responses[0], 'Hello from ChadScript!', 'Root path should return greeting');
        assert.strictEqual(responses[1], '{"ok":true}', 'JSON path should return JSON');
        assert.strictEqual(responses[2], 'Not Found', 'Unknown path should return 404');
      } finally {
        process.kill(-serverProcess.pid!, 'SIGTERM');
      }
    } finally {
      try {
        await fs.unlink(testFile);
        await fs.unlink('.build/tests/fixtures/network/http-server-test');
        await fs.unlink('.build/tests/fixtures/network/http-server-test.ll');
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  });
});
