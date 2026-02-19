#!/usr/bin/env node
import { spawn, execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
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

const chad = path.join(projectRoot, '.build', 'chad');
if (!fs.existsSync(chad)) {
  console.log('Building native compiler (.build/chad)...');
  try {
    execSync('node dist/chad-node.js build src/chad-native.ts -o .build/chad', { cwd: projectRoot, stdio: 'inherit' });
  } catch (error) {
    console.error('Native compiler build failed');
    process.exit(1);
  }
}

const args = process.argv.slice(2);

const testPattern = args.length === 0 ? [
  'tests/compiler.test.ts',
  'tests/unit/symbol-table.test.ts',
  'tests/unit/type-system.test.ts',
  'tests/network.test.ts',
  'tests/tcp-server-full.test.ts',
  'tests/http-routes.test.ts',
] : args;

const nodeArgs = ['--import', 'tsx', '--test', ...testPattern];

const child = spawn('node', nodeArgs, {
  stdio: 'inherit',
  shell: false
});

child.on('exit', (code) => {
  if (code !== 0 || args.length > 0) {
    process.exit(code);
    return;
  }

  console.log('\nRe-running compiler tests with Node.js compiler...');
  const child2 = spawn('node', ['--import', 'tsx', '--test', 'tests/compiler.test.ts'], {
    stdio: 'inherit',
    shell: false,
    env: { ...process.env, CHAD_COMPILER: 'node dist/chad-node.js build' }
  });
  child2.on('exit', (code2) => {
    process.exit(code2);
  });
});
