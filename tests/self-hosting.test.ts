import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as path from 'node:path';
import { testCases, TestCase } from './test-fixtures';

const execAsync = promisify(exec);

const CHADC = '.build/chadc';
const STAGE0 = '/tmp/chad-stage0';
const STAGE1 = '/tmp/chad-stage1';
const STAGE2 = '/tmp/chad-stage2';
const STAGE3 = '/tmp/chad-stage3';
const FIXTURE_OUT_DIR = '/tmp/self-hosting-fixtures';

const isMac = process.platform === 'darwin';
const brewPrefix = process.arch === 'arm64' ? '/opt/homebrew' : '/usr/local';

const NATIVE_ENV: NodeJS.ProcessEnv = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  LIBRARY_PATH: isMac
    ? `${brewPrefix}/lib:${brewPrefix}/opt/openssl/lib:${brewPrefix}/opt/sqlite/lib:${brewPrefix}/opt/zstd/lib:/usr/lib`
    : '/lib64:/usr/lib:/usr/lib64:/usr/local/lib',
  TERM: process.env.TERM || 'dumb',
};

const STAGE0_TODO = new Set<string>([
]);

const STAGE1_TODO = new Set<string>([
]);

function isCrashSignal(signal: string | null): boolean {
  return signal === 'SIGSEGV' || signal === 'SIGABRT' || signal === 'SIGBUS';
}

async function execWithRetry(cmd: string, opts: { timeout: number; env?: NodeJS.ProcessEnv }, retries = 3): Promise<{ stdout: string; stderr: string }> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await execAsync(cmd, opts);
    } catch (err: any) {
      if (isCrashSignal(err.signal) && attempt < retries) {
        continue;
      }
      const stdout = err.stdout?.slice(-2000) || '';
      const stderr = err.stderr?.slice(-2000) || '';
      throw new Error(
        `${err.message}\n` +
        `signal: ${err.signal}, code: ${err.code}, attempts: ${attempt}\n` +
        `stdout (last 2000 chars):\n${stdout}\n` +
        `stderr (last 2000 chars):\n${stderr}`
      );
    }
  }
  throw new Error('unreachable');
}

async function runFixture(compiler: string, tc: TestCase, outDir: string): Promise<void> {
  const ext = path.extname(tc.fixture);
  const baseName = path.basename(tc.fixture, ext);
  const exePath = path.join(outDir, baseName);

  try {
    if (fsSync.existsSync(exePath)) await fs.unlink(exePath);
  } catch {}

  try {
    await execAsync(`${compiler} ${tc.fixture} -o ${exePath}`, { timeout: 30000, env: NATIVE_ENV });
  } catch (err: any) {
    if (isCrashSignal(err.signal)) {
      throw new Error(`Compiler crashed with ${err.signal} on ${tc.fixture}\nstderr: ${err.stderr?.slice(0, 1000) || ''}`);
    }
    throw new Error(`Compilation failed for ${tc.fixture}\nstderr: ${err.stderr?.slice(0, 1000) || ''}\nstdout: ${err.stdout?.slice(0, 500) || ''}`);
  }

  assert.ok(fsSync.existsSync(exePath), `Binary should exist at ${exePath}`);

  const args = tc.args ? tc.args.join(' ') : '';
  const command = args ? `${exePath} ${args}` : exePath;

  let result: any;
  let actualExitCode = 0;

  try {
    result = await execAsync(command, { timeout: 10000 });
  } catch (err: any) {
    if (isCrashSignal(err.signal)) {
      throw new Error(`Binary crashed with ${err.signal} for ${tc.fixture}`);
    }
    actualExitCode = err.code || err.status || 1;
    result = err;
  }

  if (tc.expectTestPassed) {
    const stdout = result.stdout || '';
    if (!stdout.includes('TEST_PASSED')) {
      throw new Error(`${tc.name}: expected TEST_PASSED in stdout, got: ${stdout.slice(0, 500)}\nstderr: ${(result.stderr || '').slice(0, 500)}`);
    }
    assert.strictEqual(actualExitCode, 0, `${tc.name}: expected exit code 0, got ${actualExitCode}`);
  } else if (tc.expectedExitCode !== undefined) {
    assert.strictEqual(actualExitCode, tc.expectedExitCode, `${tc.name}: expected exit ${tc.expectedExitCode}, got ${actualExitCode}`);
  } else {
    throw new Error(`${tc.name}: test must specify either expectedExitCode or expectTestPassed`);
  }
}

describe('Self-Hosting', { timeout: 600000 }, () => {
  describe('Stage 0 (chadc): all fixtures', { concurrency: 4 }, () => {
    const outDir = path.join(FIXTURE_OUT_DIR, 'stage0');

    before(() => {
      assert.ok(
        fsSync.existsSync(CHADC),
        `Native compiler not found at ${CHADC} — build it first with: npm run build && node dist/chadc-node.js src/chadc-native.ts -o .build/chadc`
      );
      fsSync.mkdirSync(outDir, { recursive: true });
    });

    for (const tc of testCases) {
      const todo = STAGE0_TODO.has(tc.name) ? 'Stage 0 codegen limitation' : undefined;
      it(`[chadc] ${tc.name}: ${tc.description}`, { todo }, async () => {
        await runFixture(CHADC, tc, outDir);
      });
    }
  });

  describe('Self-hosting chain', { timeout: 600000 }, () => {
    it('Node.js → Stage 0: compile chadc-native.ts', async () => {
      if (fsSync.existsSync(STAGE0)) fsSync.unlinkSync(STAGE0);

      await execAsync(
        `node dist/chadc-node.js src/chadc-native.ts -o ${STAGE0}`,
        { timeout: 180000 }
      );

      assert.ok(fsSync.existsSync(STAGE0), `Stage 0 binary should exist at ${STAGE0}`);
      const stats = fsSync.statSync(STAGE0);
      assert.ok(stats.size > 100000, `Stage 0 binary should be substantial (got ${stats.size} bytes)`);
    });

    it('Stage 0 smoke test: compile and run hello.ts', async () => {
      assert.ok(fsSync.existsSync(STAGE0), 'Stage 0 binary must exist');

      const outBinary = '/tmp/hello-stage0';
      try {
        await execAsync(`${STAGE0} examples/hello.ts -o ${outBinary}`, { timeout: 30000, env: NATIVE_ENV });
        assert.ok(fsSync.existsSync(outBinary), 'Stage 0 should produce output binary');

        const { stdout } = await execAsync(outBinary, { timeout: 10000 });
        assert.ok(stdout.includes('Hello from ChadScript'), 'Output should contain expected text');
      } finally {
        try { if (fsSync.existsSync(outBinary)) fsSync.unlinkSync(outBinary); } catch {}
      }
    });

    it('Stage 0 → Stage 1: Stage 0 compiles native-compiler.ts', async () => {
      assert.ok(fsSync.existsSync(STAGE0), 'Stage 0 binary must exist');
      if (fsSync.existsSync(STAGE1)) fsSync.unlinkSync(STAGE1);

      await execWithRetry(
        `${STAGE0} -v src/chadc-native.ts -o ${STAGE1}`,
        { timeout: 180000, env: NATIVE_ENV }
      );

      assert.ok(fsSync.existsSync(STAGE1), `Stage 1 binary should exist at ${STAGE1}`);
      const stats = fsSync.statSync(STAGE1);
      assert.ok(stats.size > 100000, `Stage 1 binary should be substantial (got ${stats.size} bytes)`);
    });

    it('Stage 1 smoke test: compile and run hello.ts', async () => {
      assert.ok(fsSync.existsSync(STAGE1), 'Stage 1 binary must exist');

      const outBinary = '/tmp/hello-stage1';
      try {
        await execAsync(`${STAGE1} examples/hello.ts -o ${outBinary}`, { timeout: 30000, env: NATIVE_ENV });
        assert.ok(fsSync.existsSync(outBinary), 'Stage 1 should produce output binary');

        const { stdout } = await execAsync(outBinary, { timeout: 10000 });
        assert.ok(stdout.includes('Hello from ChadScript'), 'Output should contain expected text');
      } finally {
        try { if (fsSync.existsSync(outBinary)) fsSync.unlinkSync(outBinary); } catch {}
      }
    });

    it('Stage 1 → Stage 2: Stage 1 compiles native-compiler.ts', async () => {
      assert.ok(fsSync.existsSync(STAGE1), 'Stage 1 binary must exist');
      if (fsSync.existsSync(STAGE2)) fsSync.unlinkSync(STAGE2);

      await execWithRetry(
        `${STAGE1} -v src/chadc-native.ts -o ${STAGE2}`,
        { timeout: 180000, env: NATIVE_ENV }
      );

      assert.ok(fsSync.existsSync(STAGE2), `Stage 2 binary should exist at ${STAGE2}`);
      const stats = fsSync.statSync(STAGE2);
      assert.ok(stats.size > 100000, `Stage 2 binary should be substantial (got ${stats.size} bytes)`);
    });

    it('Stage 2 smoke test: compile and run hello.ts', async () => {
      assert.ok(fsSync.existsSync(STAGE2), 'Stage 2 binary must exist');

      const outBinary = '/tmp/hello-stage2';
      try {
        await execAsync(`${STAGE2} examples/hello.ts -o ${outBinary}`, { timeout: 30000, env: NATIVE_ENV });
        assert.ok(fsSync.existsSync(outBinary), 'Stage 2 should produce output binary');

        const { stdout } = await execAsync(outBinary, { timeout: 10000 });
        assert.ok(stdout.includes('Hello from ChadScript'), 'Output should contain expected text');
      } finally {
        try { if (fsSync.existsSync(outBinary)) fsSync.unlinkSync(outBinary); } catch {}
      }
    });

    it('Stage 2 → Stage 3: Stage 2 compiles native-compiler.ts', async () => {
      assert.ok(fsSync.existsSync(STAGE2), 'Stage 2 binary must exist');
      if (fsSync.existsSync(STAGE3)) fsSync.unlinkSync(STAGE3);

      await execWithRetry(
        `${STAGE2} -v src/chadc-native.ts -o ${STAGE3}`,
        { timeout: 180000, env: NATIVE_ENV }
      );

      assert.ok(fsSync.existsSync(STAGE3), `Stage 3 binary should exist at ${STAGE3}`);
      const stats = fsSync.statSync(STAGE3);
      assert.ok(stats.size > 100000, `Stage 3 binary should be substantial (got ${stats.size} bytes)`);
    });

    it('Stage 3 smoke test: compile and run hello.ts', async () => {
      assert.ok(fsSync.existsSync(STAGE3), 'Stage 3 binary must exist');

      const outBinary = '/tmp/hello-stage3';
      try {
        await execAsync(`${STAGE3} examples/hello.ts -o ${outBinary}`, { timeout: 30000, env: NATIVE_ENV });
        assert.ok(fsSync.existsSync(outBinary), 'Stage 3 should produce output binary');

        const { stdout } = await execAsync(outBinary, { timeout: 10000 });
        assert.ok(stdout.includes('Hello from ChadScript'), 'Output should contain expected text');
      } finally {
        try { if (fsSync.existsSync(outBinary)) fsSync.unlinkSync(outBinary); } catch {}
      }
    });

    it('Bootstrap verification: Stage 1 and Stage 2 produce identical IR', async () => {
      assert.ok(fsSync.existsSync(STAGE1), 'Stage 1 binary must exist');
      assert.ok(fsSync.existsSync(STAGE2), 'Stage 2 binary must exist');

      const testFile = 'tests/fixtures/strings/string-length.js';
      const s1Out = '/tmp/bootstrap-s1';
      const s2Out = '/tmp/bootstrap-s2';
      const s1LL = '/tmp/bootstrap-s1.ll';
      const s2LL = '/tmp/bootstrap-s2.ll';

      try {
        await execAsync(`${STAGE1} ${testFile} -o ${s1Out}`, { timeout: 30000, env: NATIVE_ENV });
        await execAsync(`${STAGE2} ${testFile} -o ${s2Out}`, { timeout: 30000, env: NATIVE_ENV });

        const ll1 = await fs.readFile(s1LL, 'utf-8');
        const ll2 = await fs.readFile(s2LL, 'utf-8');

        assert.strictEqual(ll1, ll2, 'Stage 1 and Stage 2 should produce identical LLVM IR');
      } finally {
        for (const f of [s1Out, s2Out, s1LL, s2LL]) {
          try { if (fsSync.existsSync(f)) fsSync.unlinkSync(f); } catch {}
        }
      }
    });

    it('Bootstrap verification: Stage 2 and Stage 3 produce identical IR', async () => {
      assert.ok(fsSync.existsSync(STAGE2), 'Stage 2 binary must exist');
      assert.ok(fsSync.existsSync(STAGE3), 'Stage 3 binary must exist');

      const testFile = 'tests/fixtures/strings/string-length.js';
      const s2Out = '/tmp/bootstrap-s2b';
      const s3Out = '/tmp/bootstrap-s3';
      const s2LL = '/tmp/bootstrap-s2b.ll';
      const s3LL = '/tmp/bootstrap-s3.ll';

      try {
        await execAsync(`${STAGE2} ${testFile} -o ${s2Out}`, { timeout: 30000, env: NATIVE_ENV });
        await execAsync(`${STAGE3} ${testFile} -o ${s3Out}`, { timeout: 30000, env: NATIVE_ENV });

        const ll2 = await fs.readFile(s2LL, 'utf-8');
        const ll3 = await fs.readFile(s3LL, 'utf-8');

        assert.strictEqual(ll2, ll3, 'Stage 2 and Stage 3 should produce identical LLVM IR');
      } finally {
        for (const f of [s2Out, s3Out, s2LL, s3LL]) {
          try { if (fsSync.existsSync(f)) fsSync.unlinkSync(f); } catch {}
        }
      }
    });
  });

  describe('Stage 1: all fixtures', { concurrency: 4 }, () => {
    const outDir = path.join(FIXTURE_OUT_DIR, 'stage1');

    before(() => {
      assert.ok(
        fsSync.existsSync(STAGE1),
        `Stage 1 binary not found at ${STAGE1} — the self-hosting chain must run first`
      );
      fsSync.mkdirSync(outDir, { recursive: true });
    });

    for (const tc of testCases) {
      const todo = STAGE1_TODO.has(tc.name) ? 'Stage 1 codegen limitation' : undefined;
      it(`[stage1] ${tc.name}: ${tc.description}`, { todo }, async () => {
        await runFixture(STAGE1, tc, outDir);
      });
    }
  });

  describe('Stage 2: all fixtures', { concurrency: 4 }, () => {
    const outDir = path.join(FIXTURE_OUT_DIR, 'stage2');

    before(() => {
      assert.ok(
        fsSync.existsSync(STAGE2),
        `Stage 2 binary not found at ${STAGE2} — the self-hosting chain must run first`
      );
      fsSync.mkdirSync(outDir, { recursive: true });
    });

    for (const tc of testCases) {
      const todo = STAGE1_TODO.has(tc.name) ? 'Stage 2 codegen limitation' : undefined;
      it(`[stage2] ${tc.name}: ${tc.description}`, { todo }, async () => {
        await runFixture(STAGE2, tc, outDir);
      });
    }
  });
});
