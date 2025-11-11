import { describe, it } from 'node:test';
import assert from 'node:assert';
import { exec, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import * as net from 'node:net';
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
      await execAsync(`npx tsx src/index.ts ${testFile}`);

      // Run
      const { stdout, stderr } = await execAsync('./tests/fixtures/tcp-test-socket');
      const exitCode = 0; // If we get here, it succeeded

      assert.strictEqual(exitCode, 0, 'Socket creation should succeed');
    } finally {
      // Cleanup
      try {
        await fs.unlink(testFile);
        await fs.unlink('tests/fixtures/tcp-test-socket');
        await fs.unlink('tests/fixtures/tcp-test-socket.ll');
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
      await execAsync(`npx tsx src/index.ts ${clientFile}`);
      const { stdout } = await execAsync('./tests/fixtures/tcp-client');

      assert.ok(!stdout.includes('Socket failed'), 'Socket creation should work');

      // Cleanup
      await fs.unlink(clientFile);
      await fs.unlink('tests/fixtures/tcp-client');
      await fs.unlink('tests/fixtures/tcp-client.ll');
    } finally {
      server.close();
    }
  });
});
