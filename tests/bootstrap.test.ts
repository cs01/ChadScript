import { describe, it } from 'node:test';
import assert from 'node:assert';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as path from 'node:path';

const execAsync = promisify(exec);

describe('Bootstrap Tests', { timeout: 180000 }, () => {
  const stage1Binary = '.build/src/native-compiler';
  const stage2Binary = '.build/src/native-compiler-stage2';

  it('Stage 0→1: native-compiler.ts compiles to Stage 1 binary', async () => {
    if (fsSync.existsSync(stage1Binary)) {
      fsSync.unlinkSync(stage1Binary);
    }

    await execAsync(
      'npx tsx src/index.ts --use-ts-parser --link-tree-sitter --skip-semantic-analysis src/native-compiler.ts',
      { timeout: 120000 }
    );

    assert.ok(
      fsSync.existsSync(stage1Binary),
      `Stage 1 binary should exist at ${stage1Binary}`
    );

    const stats = fsSync.statSync(stage1Binary);
    assert.ok(stats.size > 100000, `Stage 1 binary should be substantial (got ${stats.size} bytes)`);
  });

  it('Stage 1: can compile a simple example', async () => {
    assert.ok(fsSync.existsSync(stage1Binary), 'Stage 1 binary must exist');

    const testFile = '/tmp/bootstrap_hello.ts';
    fsSync.writeFileSync(testFile, 'console.log("hello from stage 1");\n');

    try {
      await execAsync(`${stage1Binary} ${testFile}`, { timeout: 30000 });

      const outputBinary = '/tmp/bootstrap_hello';
      assert.ok(fsSync.existsSync(outputBinary), 'Stage 1 should produce output binary');

      const { stdout } = await execAsync(outputBinary);
      assert.ok(stdout.includes('hello from stage 1'), 'Output should contain expected text');
    } finally {
      for (const f of [testFile, '/tmp/bootstrap_hello', '/tmp/bootstrap_hello.ll']) {
        if (fsSync.existsSync(f)) fsSync.unlinkSync(f);
      }
    }
  });

  it('Stage 1: can run all smoke test examples', async () => {
    assert.ok(fsSync.existsSync(stage1Binary), 'Stage 1 binary must exist');

    const examples = [
      { file: 'tests/fixtures/arithmetic/simple-add.js', expectedExit: 12 },
      { file: 'tests/fixtures/control-flow/if-else.js', expectedExit: 15 },
      { file: 'tests/fixtures/control-flow/for-loop.js', expectedExit: 55 },
      { file: 'tests/fixtures/arrays/array-literal.js', expectedExit: 3 },
    ];

    for (const example of examples) {
      const baseName = path.basename(example.file, path.extname(example.file));
      const outputBinary = `.build/tests/fixtures/${path.dirname(example.file).split('/').pop()}/${baseName}`;

      await execAsync(`${stage1Binary} ${example.file}`, { timeout: 30000 });

      try {
        await execAsync(outputBinary);
      } catch (err: any) {
        assert.strictEqual(
          err.code,
          example.expectedExit,
          `${example.file}: expected exit ${example.expectedExit}, got ${err.code}`
        );
      }
    }
  });

  it('Stage 1→2: Stage 1 compiles native-compiler.ts to Stage 2', async () => {
    assert.ok(fsSync.existsSync(stage1Binary), 'Stage 1 binary must exist');

    if (fsSync.existsSync(stage2Binary)) {
      fsSync.unlinkSync(stage2Binary);
    }

    await execAsync(
      `${stage1Binary} --use-ts-parser --link-tree-sitter --skip-semantic-analysis src/native-compiler.ts -o ${stage2Binary}`,
      { timeout: 120000 }
    );

    assert.ok(
      fsSync.existsSync(stage2Binary),
      `Stage 2 binary should exist at ${stage2Binary}`
    );
  });

  it('Stage 2: produces same output as Stage 1 (bootstrap verification)', async () => {
    assert.ok(fsSync.existsSync(stage1Binary), 'Stage 1 binary must exist');
    assert.ok(fsSync.existsSync(stage2Binary), 'Stage 2 binary must exist');

    const testFile = 'tests/fixtures/arithmetic/simple-add.js';
    const stage1Output = '.build/stage1-test.ll';
    const stage2Output = '.build/stage2-test.ll';

    await execAsync(`${stage1Binary} ${testFile} -o .build/stage1-test`);
    await execAsync(`${stage2Binary} ${testFile} -o .build/stage2-test`);

    const ll1 = await fs.readFile(stage1Output, 'utf-8');
    const ll2 = await fs.readFile(stage2Output, 'utf-8');

    assert.strictEqual(ll1, ll2, 'Stage 1 and Stage 2 should produce identical LLVM IR');
  });
});
