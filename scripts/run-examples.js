#!/usr/bin/env node
import { spawn } from 'child_process';
import { readdir } from 'fs/promises';
import { join, basename } from 'path';

const EXAMPLES_DIR = 'examples';
const BUILD_DIR = '.build/examples';

const SELF_CONTAINED = [
  'hello.ts',
  'timers.ts',
  'cli-parser-demo.ts',
];

const SKIP_FILES = [
  'README.md',
  'http-server.ts',
  'word-count.ts',
];

async function runCommand(cmd, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      ...options,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => { stdout += data; });
    child.stderr.on('data', (data) => { stderr += data; });

    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });

    child.on('error', (err) => {
      resolve({ code: 1, stdout: '', stderr: err.message });
    });
  });
}

async function compileExample(file) {
  const sourcePath = join(EXAMPLES_DIR, file);
  const result = await runCommand('node', ['dist/index.js', sourcePath], {
    timeout: 60000,
  });
  return result;
}

async function runExample(file) {
  const name = basename(file, '.ts').replace('.js', '');
  const binaryPath = join(BUILD_DIR, name);
  const result = await runCommand(binaryPath, [], {
    timeout: 10000,
  });
  return result;
}

async function main() {
  console.log('=== ChadScript Examples Runner ===\n');

  const files = await readdir(EXAMPLES_DIR);
  const examples = files.filter(f =>
    SELF_CONTAINED.includes(f) && !SKIP_FILES.includes(f)
  );

  console.log(`Found ${examples.length} self-contained examples to test\n`);

  let passed = 0;
  let failed = 0;
  const failures = [];

  for (const file of examples) {
    process.stdout.write(`Testing ${file}... `);

    const compileResult = await compileExample(file);
    if (compileResult.code !== 0) {
      console.log('COMPILE FAILED');
      failures.push({ file, stage: 'compile', error: compileResult.stderr });
      failed++;
      continue;
    }

    const runResult = await runExample(file);
    if (runResult.code !== 0) {
      console.log('RUN FAILED');
      failures.push({ file, stage: 'run', error: runResult.stderr, stdout: runResult.stdout });
      failed++;
      continue;
    }

    if (!runResult.stdout.includes('TEST_PASSED')) {
      console.log('NO TEST_PASSED');
      failures.push({ file, stage: 'verify', error: 'Output did not contain TEST_PASSED', stdout: runResult.stdout });
      failed++;
      continue;
    }

    console.log('PASSED');
    passed++;
  }

  console.log('\n=== Results ===');
  console.log(`Passed: ${passed}/${examples.length}`);
  console.log(`Failed: ${failed}/${examples.length}`);

  if (failures.length > 0) {
    console.log('\n=== Failures ===');
    for (const f of failures) {
      console.log(`\n${f.file} (${f.stage}):`);
      console.log(f.error || f.stdout || 'No output');
    }
    process.exit(1);
  }

  console.log('\nAll examples passed!');
  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
