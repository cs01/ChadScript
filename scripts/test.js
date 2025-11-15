#!/usr/bin/env node
import { spawn } from 'child_process';

// Get arguments passed after 'npm test --'
const args = process.argv.slice(2);

// If no arguments provided, run all tests with glob pattern
// Otherwise, run specific test files
const testPattern = args.length === 0 ? ['tests/**/*.test.ts'] : args;

const nodeArgs = ['--import', 'tsx', '--test', ...testPattern];

const child = spawn('node', nodeArgs, {
  stdio: 'inherit',
  shell: false
});

child.on('exit', (code) => {
  process.exit(code);
});
