import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as path from 'node:path';

const execAsync = promisify(exec);

const NATIVE_COMPILER = '.build/src/native-compiler';
const EXAMPLES_DIR = 'examples';
const OUTPUT_DIR = '.build/tests/stage0-examples';

interface ExampleTest {
  file: string;
  mode: 'run' | 'compile-only';
  args?: string[];
  timeout?: number;
}

const EXAMPLES: ExampleTest[] = [
  { file: 'hello.ts', mode: 'run' },
  { file: 'timers.ts', mode: 'compile-only' },
  { file: 'cli-parser-demo.ts', mode: 'compile-only' },
  { file: 'http-handler.ts', mode: 'compile-only' },
  { file: 'word-count.ts', mode: 'compile-only' },
];

function isCrashSignal(signal: string | null): boolean {
  return signal === 'SIGSEGV' || signal === 'SIGABRT' || signal === 'SIGBUS';
}

describe('Stage 0: compile all examples without segfault', { concurrency: 1 }, () => {
  before(() => {
    assert.ok(
      fsSync.existsSync(NATIVE_COMPILER),
      `Native compiler not found at ${NATIVE_COMPILER} — build it first`
    );
    fsSync.mkdirSync(OUTPUT_DIR, { recursive: true });
  });

  for (const example of EXAMPLES) {
    const sourcePath = path.join(EXAMPLES_DIR, example.file);
    const ext = path.extname(example.file);
    const baseName = path.basename(example.file, ext);
    const exePath = path.join(OUTPUT_DIR, baseName);

    it(`${example.file}: Stage 0 compiles without segfault`, async () => {
      try {
        if (fsSync.existsSync(exePath)) await fs.unlink(exePath);
      } catch {}

      try {
        try {
          await execAsync(`${NATIVE_COMPILER} ${sourcePath} -o ${exePath}`, {
            timeout: 60000,
          });
        } catch (err: any) {
          if (isCrashSignal(err.signal)) {
            throw new Error(
              `Stage 0 compiler crashed with ${err.signal} on ${example.file}\nstderr: ${err.stderr?.slice(0, 1000) || ''}`
            );
          }
        }

        if (example.mode === 'run' && fsSync.existsSync(exePath)) {
          const args = example.args ? example.args.join(' ') : '';
          const command = args ? `${exePath} ${args}` : exePath;
          const runTimeout = example.timeout || 10000;

          let result;
          let exitCode = 0;
          try {
            result = await execAsync(command, { timeout: runTimeout });
          } catch (err: any) {
            exitCode = err.code || err.status || 1;
            result = err;
            if (isCrashSignal(err.signal)) {
              throw new Error(`${example.file} binary crashed with ${err.signal}`);
            }
          }

          const stdout = result.stdout || '';
          assert.ok(
            stdout.includes('TEST_PASSED'),
            `expected TEST_PASSED in stdout, got: ${stdout.slice(0, 500)}`
          );
          assert.strictEqual(exitCode, 0, `expected exit code 0, got ${exitCode}`);
        }
      } finally {
        try {
          if (fsSync.existsSync(exePath)) await fs.unlink(exePath);
        } catch {}
      }
    });
  }
});
