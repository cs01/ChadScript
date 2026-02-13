import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { exec, spawn, ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as zlib from 'node:zlib';
import * as http from 'node:http';

const execAsync = promisify(exec);

const SERVER_SOURCE = 'tests/fixtures/network/http-route-isolation-test.ts';
const SERVER_BINARY = '.build/tests/fixtures/network/http-route-isolation-test';
const PORT = 9987;

const SERVER_CODE = `
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

function homeHandler(req: Request): Response {
  return { status: 200, body: "Hello from ChadScript!" };
}

function jsonHandler(req: Request): Response {
  return { status: 200, body: '{"message":"hello","count":42}' };
}

function echoHandler(req: Request): Response {
  return { status: 200, body: req.body };
}

function echoQueryHandler(req: Request): Response {
  return { status: 200, body: req.path.substring(10, req.path.length) };
}

function statusHandler(req: Request): Response {
  const code = req.path.substring(8, req.path.length);
  return { status: 200, body: "Status " + code };
}

function contentTypeHandler(req: Request): Response {
  return { status: 200, body: "Content-Type: " + req.contentType };
}

function errorHandler(req: Request): Response {
  return { status: 500, body: "Internal Server Error" };
}

function createdHandler(req: Request): Response {
  return { status: 201, body: "Resource Created" };
}

function largeHandler(req: Request): Response {
  let body = "<html><head><title>Large Response</title></head><body>";
  body = body + "<h1>This is a large response for compression testing</h1>";
  body = body + "<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.</p>";
  body = body + "<p>Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.</p>";
  body = body + "<p>Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.</p>";
  body = body + "</body></html>";
  return { status: 200, body: body };
}

function notFoundHandler(req: Request): Response {
  return { status: 404, body: "Not Found" };
}

function handleRequest(req: Request): Response {
  if (req.method == "GET") {
    if (req.path == "/") return homeHandler(req);
    if (req.path == "/json") return jsonHandler(req);
    if (req.path.startsWith("/echo?msg=")) return echoQueryHandler(req);
    if (req.path.startsWith("/status/")) return statusHandler(req);
    if (req.path == "/content-type") return contentTypeHandler(req);
    if (req.path == "/large") return largeHandler(req);
    if (req.path == "/error") return errorHandler(req);
    if (req.path == "/created") return createdHandler(req);
  }

  if (req.method == "POST") {
    if (req.path == "/echo") return echoHandler(req);
  }

  return notFoundHandler(req);
}

httpServe(${PORT}, handleRequest);
`;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe('HTTP Route Isolation Tests', { concurrency: 1 }, () => {
  let serverProcess: ChildProcess | null = null;

  before(async () => {
    await fs.mkdir('tests/fixtures/network', { recursive: true });
    await fs.writeFile(SERVER_SOURCE, SERVER_CODE);

    await execAsync(`node dist/index.js ${SERVER_SOURCE}`, { timeout: 60000 });
    assert.ok(fsSync.existsSync(SERVER_BINARY), 'Server binary should exist');
  });

  after(async () => {
    if (serverProcess?.pid) {
      try { process.kill(-serverProcess.pid, 'SIGTERM'); } catch {}
    }
    try { await fs.unlink(SERVER_SOURCE); } catch {}
    try { await fs.unlink(SERVER_BINARY); } catch {}
    try { await fs.unlink(SERVER_BINARY + '.ll'); } catch {}
  });

  async function startServer(): Promise<ChildProcess> {
    if (serverProcess?.pid && isProcessAlive(serverProcess.pid)) {
      try { process.kill(-serverProcess.pid, 'SIGTERM'); } catch {}
      await sleep(500);
    }

    serverProcess = spawn(SERVER_BINARY, [], {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    await sleep(1000);

    assert.ok(serverProcess.pid, 'Server should have a PID');
    assert.ok(isProcessAlive(serverProcess.pid), 'Server should be alive after start');

    return serverProcess;
  }

  async function stopServer(): Promise<void> {
    if (serverProcess?.pid) {
      try { process.kill(-serverProcess.pid, 'SIGTERM'); } catch {}
      await sleep(500);
      serverProcess = null;
    }
  }

  async function testRoute(
    method: string,
    path: string,
    opts?: { body?: string; expectedStatus?: number; expectedBody?: string; bodyContains?: string }
  ): Promise<void> {
    const srv = await startServer();
    const pid = srv.pid!;

    try {
      const url = `http://127.0.0.1:${PORT}${path}`;
      const fetchOpts: RequestInit = {
        method,
        body: opts?.body,
        headers: opts?.body ? { 'Content-Type': 'text/plain' } : undefined,
      };

      const response = await fetch(url, fetchOpts);
      const body = await response.text();

      assert.ok(isProcessAlive(pid), `Server crashed (segfault) after ${method} ${path}`);

      if (opts?.expectedStatus !== undefined) {
        assert.strictEqual(response.status, opts.expectedStatus,
          `${method} ${path}: expected status ${opts.expectedStatus}, got ${response.status}`);
      }
      if (opts?.expectedBody !== undefined) {
        assert.strictEqual(body, opts.expectedBody,
          `${method} ${path}: expected body "${opts.expectedBody}", got "${body}"`);
      }
      if (opts?.bodyContains !== undefined) {
        assert.ok(body.includes(opts.bodyContains),
          `${method} ${path}: expected body to contain "${opts.bodyContains}", got "${body}"`);
      }
    } finally {
      await stopServer();
    }
  }

  it('GET / returns home page without crash', async () => {
    await testRoute('GET', '/', {
      expectedStatus: 200,
      expectedBody: 'Hello from ChadScript!'
    });
  });

  it('GET /json returns JSON without crash', async () => {
    await testRoute('GET', '/json', {
      expectedStatus: 200,
      expectedBody: '{"message":"hello","count":42}'
    });
  });

  it('GET /echo?msg=test echoes query param without crash', async () => {
    await testRoute('GET', '/echo?msg=test', {
      expectedStatus: 200,
      bodyContains: 'test'
    });
  });

  it('GET /status/418 returns status without crash', async () => {
    await testRoute('GET', '/status/418', {
      expectedStatus: 200,
      bodyContains: '418'
    });
  });

  it('GET /content-type returns content type without crash', async () => {
    await testRoute('GET', '/content-type', {
      expectedStatus: 200,
      bodyContains: 'Content-Type:'
    });
  });

  it('GET /error returns 500 without crash', async () => {
    await testRoute('GET', '/error', {
      expectedStatus: 500,
      expectedBody: 'Internal Server Error'
    });
  });

  it('GET /created returns 201 without crash', async () => {
    await testRoute('GET', '/created', {
      expectedStatus: 201,
      expectedBody: 'Resource Created'
    });
  });

  it('POST /echo echoes body without crash', async () => {
    await testRoute('POST', '/echo', {
      expectedStatus: 200,
      body: 'hello world',
      expectedBody: 'hello world'
    });
  });

  it('GET /nonexistent returns 404 without crash', async () => {
    await testRoute('GET', '/nonexistent', {
      expectedStatus: 404,
      expectedBody: 'Not Found'
    });
  });

  it('server survives multiple sequential requests', async () => {
    const srv = await startServer();
    const pid = srv.pid!;

    try {
      const routes = ['/', '/json', '/error', '/created', '/nonexistent'];
      for (const route of routes) {
        const resp = await fetch(`http://127.0.0.1:${PORT}${route}`);
        await resp.text();
        assert.ok(isProcessAlive(pid), `Server crashed after GET ${route}`);
      }
    } finally {
      await stopServer();
    }
  });

  it('server survives concurrent requests', async () => {
    const srv = await startServer();
    const pid = srv.pid!;

    try {
      const requests = [
        fetch(`http://127.0.0.1:${PORT}/`),
        fetch(`http://127.0.0.1:${PORT}/json`),
        fetch(`http://127.0.0.1:${PORT}/error`),
        fetch(`http://127.0.0.1:${PORT}/created`),
        fetch(`http://127.0.0.1:${PORT}/nonexistent`),
      ];

      const responses = await Promise.all(requests);
      for (const resp of responses) {
        await resp.text();
      }

      assert.ok(isProcessAlive(pid), 'Server crashed after concurrent requests');
    } finally {
      await stopServer();
    }
  });

  it('GET /large with Accept-Encoding: deflate returns compressed response', async () => {
    const srv = await startServer();
    const pid = srv.pid!;

    try {
      const { headers, body } = await new Promise<{ headers: http.IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
        const req = http.request({
          hostname: '127.0.0.1',
          port: PORT,
          path: '/large',
          method: 'GET',
          headers: { 'Accept-Encoding': 'deflate' }
        }, (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => resolve({ headers: res.headers, body: Buffer.concat(chunks) }));
        });
        req.on('error', reject);
        req.end();
      });

      assert.ok(isProcessAlive(pid), 'Server crashed after deflate request');
      assert.strictEqual(headers['content-encoding'], 'deflate', 'Response should have Content-Encoding: deflate');

      const decompressed = zlib.inflateSync(body);
      const text = decompressed.toString('utf-8');
      assert.ok(text.includes('Large Response'), 'Decompressed body should contain expected content');
      assert.ok(text.startsWith('<html>'), 'Decompressed body should start with <html>');
    } finally {
      await stopServer();
    }
  });

  it('GET /json with Accept-Encoding: deflate skips compression for small body', async () => {
    const srv = await startServer();
    const pid = srv.pid!;

    try {
      const { headers, body } = await new Promise<{ headers: http.IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
        const req = http.request({
          hostname: '127.0.0.1',
          port: PORT,
          path: '/json',
          method: 'GET',
          headers: { 'Accept-Encoding': 'deflate' }
        }, (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => resolve({ headers: res.headers, body: Buffer.concat(chunks) }));
        });
        req.on('error', reject);
        req.end();
      });

      assert.ok(isProcessAlive(pid), 'Server crashed after deflate request to small body');
      assert.strictEqual(headers['content-encoding'], undefined, 'Small response should NOT have Content-Encoding header');
      assert.strictEqual(body.toString('utf-8'), '{"message":"hello","count":42}');
    } finally {
      await stopServer();
    }
  });

  it('GET /large without Accept-Encoding does not compress', async () => {
    const srv = await startServer();
    const pid = srv.pid!;

    try {
      const { headers, body } = await new Promise<{ headers: http.IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
        const req = http.request({
          hostname: '127.0.0.1',
          port: PORT,
          path: '/large',
          method: 'GET',
          headers: { 'Accept-Encoding': 'identity' }
        }, (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => resolve({ headers: res.headers, body: Buffer.concat(chunks) }));
        });
        req.on('error', reject);
        req.end();
      });

      assert.ok(isProcessAlive(pid), 'Server crashed after non-deflate request');
      assert.strictEqual(headers['content-encoding'], undefined, 'Response without Accept-Encoding: deflate should not be compressed');
      const text = body.toString('utf-8');
      assert.ok(text.includes('Large Response'), 'Body should contain expected content');
    } finally {
      await stopServer();
    }
  });
});
