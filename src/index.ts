#!/usr/bin/env node

import { compile } from './compiler.js';
import { LogLevel, logger } from './utils/logger.js';

// ============================================
// CLI ENTRY POINT
// ============================================

const args = process.argv.slice(2);

// Parse flags
let logLevel = LogLevel.Normal;
const fileArgs: string[] = [];

for (const arg of args) {
  if (arg === '-v' || arg === '--verbose') {
    logLevel = LogLevel.Verbose;
  } else if (arg === '--debug') {
    logLevel = LogLevel.Debug;
  } else if (arg === '--trace') {
    logLevel = LogLevel.Trace;
  } else if (arg === '-h' || arg === '--help') {
    console.log('ChadScript - TypeScript to Native AOT Compiler');
    console.log('');
    console.log('Usage: chadscript [options] <input.ts|.js> [output]');
    console.log('');
    console.log('Options:');
    console.log('  -v, --verbose    Show compilation steps');
    console.log('  --debug          Show internal debugging information');
    console.log('  --trace          Show everything (AST, IR, variable tracking)');
    console.log('  -h, --help       Show this help message');
    console.log('');
    console.log('Examples:');
    console.log('  chadscript hello.ts');
    console.log('  chadscript hello.ts my-program');
    console.log('  chadscript -v hello.ts');
    console.log('  chadscript --debug hello.ts');
    process.exit(0);
  } else {
    fileArgs.push(arg);
  }
}

if (fileArgs.length < 1) {
  logger.error('chadscript: error: no input files');
  logger.error('Usage: chadscript [options] <input.ts|.js> [output]');
  process.exit(1);
}

const inputFile = fileArgs[0];
const outputFile = fileArgs[1] || inputFile.replace(/\.(js|ts)$/, '');

try {
  compile(inputFile, outputFile, logLevel);
} catch (error) {
  // Error messages are already formatted by the compiler
  logger.error((error as Error).message);
  process.exit(1);
}
