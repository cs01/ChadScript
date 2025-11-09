#!/usr/bin/env node

import { compile } from './compiler.js';

// ============================================
// CLI ENTRY POINT
// ============================================

const args = process.argv.slice(2);

if (args.length < 1) {
  console.error('Usage: chadscript <input.js> [output]');
  console.error('');
  console.error('Examples:');
  console.error('  chadscript examples/add.js');
  console.error('  chadscript examples/add.js my-program');
  process.exit(1);
}

const inputFile = args[0];
const outputFile = args[1] || inputFile.replace(/\.js$/, '');

try {
  compile(inputFile, outputFile);
} catch (error) {
  console.error('Compilation error:', (error as Error).message);
  process.exit(1);
}
