import { describe, it } from 'node:test';
import assert from 'node:assert';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as path from 'node:path';

const execAsync = promisify(exec);

const EXAMPLES_DIR = 'examples';
const BUILD_DIR = '.build/examples';

interface ExampleTest {
  file: string;
  mode: 'run' | 'compile-only';
  args?: string[];
  timeout?: number;
}

const EXAMPLES: ExampleTest[] = [
  { file: 'hello.ts', mode: 'run' },
  { file: 'timers.ts', mode: 'run', timeout: 15000 },
  { file: 'cli-parser-demo.ts', mode: 'run' },
  { file: 'query.ts', mode: 'run' },
  { file: 'http-server.ts', mode: 'compile-only' },
  { file: 'word-count.ts', mode: 'compile-only' },
  { file: 'parallel.ts', mode: 'compile-only' },
  { file: 'hackernews/app.ts', mode: 'compile-only' },
  { file: 'websocket-server.ts', mode: 'compile-only' },
];

describe('Examples Integration', { concurrency: 1 }, () => {
  for (const example of EXAMPLES) {
    const sourcePath = path.join(EXAMPLES_DIR, example.file);
    const ext = path.extname(example.file);
    const baseName = path.basename(example.file, ext);
    const subdir = path.dirname(example.file);
    const outputDir = subdir !== '.' ? path.join(BUILD_DIR, subdir) : BUILD_DIR;
    const exeFile = path.join(outputDir, baseName);
    const llFile = path.join(outputDir, `${baseName}.ll`);

    if (example.mode === 'run') {
      it(`${example.file}: compiles and runs without crash`, async () => {
        try {
          if (fsSync.existsSync(llFile)) await fs.unlink(llFile);
          if (fsSync.existsSync(exeFile)) await fs.unlink(exeFile);
        } catch {}

        try {
          const compileResult = await execAsync(`node dist/chad-node.js build ${sourcePath}`, { timeout: 60000 });
          assert.ok(fsSync.existsSync(exeFile), `binary should exist at ${exeFile}`);

          const args = example.args ? example.args.join(' ') : '';
          const command = args ? `${exeFile} ${args}` : exeFile;
          const runTimeout = example.timeout || 10000;

          let result;
          let exitCode = 0;
          try {
            result = await execAsync(command, { timeout: runTimeout });
          } catch (err: any) {
            exitCode = err.code || err.status || 1;
            result = err;
            if (err.signal === 'SIGSEGV' || err.signal === 'SIGABRT' || err.signal === 'SIGBUS') {
              throw new Error(`${example.file} crashed with ${err.signal}`);
            }
          }

          const stdout = result.stdout || '';
          assert.ok(stdout.length > 0,
            `expected non-empty stdout, got empty output`);
          assert.strictEqual(exitCode, 0, `expected exit code 0, got ${exitCode}`);
        } finally {
          try {
            if (fsSync.existsSync(llFile)) await fs.unlink(llFile);
            if (fsSync.existsSync(exeFile)) await fs.unlink(exeFile);
          } catch {}
        }
      });
    } else {
      it(`${example.file}: compiles without error`, async () => {
        try {
          if (fsSync.existsSync(llFile)) await fs.unlink(llFile);
          if (fsSync.existsSync(exeFile)) await fs.unlink(exeFile);
        } catch {}

        try {
          await execAsync(`node dist/chad-node.js build ${sourcePath}`, { timeout: 60000 });
          assert.ok(fsSync.existsSync(exeFile), `binary should exist at ${exeFile}`);
        } finally {
          try {
            if (fsSync.existsSync(llFile)) await fs.unlink(llFile);
            if (fsSync.existsSync(exeFile)) await fs.unlink(exeFile);
          } catch {}
        }
      });
    }
  }
});
