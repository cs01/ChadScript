#!/usr/bin/env node
import { spawn, execSync } from 'child_process';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

console.log('Building compiler...');
try {
  execSync('npm run build', { cwd: projectRoot, stdio: 'inherit' });
} catch (error) {
  console.error('Build failed');
  process.exit(1);
}

const args = process.argv.slice(2);

const testPattern = args.length === 0 ? [
  'tests/compiler.test.ts',
  'tests/unit/symbol-table.test.ts',
  'tests/network.test.ts',
  'tests/tcp-server-full.test.ts'
] : args;

const nodeArgs = ['--import', 'tsx', '--test', ...testPattern];

const child = spawn('node', nodeArgs, {
  stdio: 'inherit',
  shell: false
});

child.on('exit', (code) => {
  process.exit(code);
});
