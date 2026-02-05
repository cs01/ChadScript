#!/usr/bin/env node

import { compile, setUseTSParser, setLinkTreeSitter, setSkipSemanticAnalysis, setKeepTemps, setEmitLLVMOnly } from './compiler.js';
import { LogLevel, logger } from './utils/logger.js';
import * as path from 'path';
import * as fs from 'fs';

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
  } else if (arg === '--use-ts-parser') {
    setUseTSParser(true);
  } else if (arg === '--link-tree-sitter') {
    setLinkTreeSitter(true);
  } else if (arg === '--skip-semantic-analysis') {
    setSkipSemanticAnalysis(true);
  } else if (arg === '--keep-temps' || arg === '-save-temps') {
    setKeepTemps(true);
  } else if (arg === '--emit-llvm' || arg === '-S') {
    setEmitLLVMOnly(true);
  } else if (arg === '-h' || arg === '--help') {
    console.log('ChadScript - TypeScript to Native AOT Compiler');
    console.log('');
    console.log('Usage: chadscript [options] <input.ts|.js> [output]');
    console.log('');
    console.log('Options:');
    console.log('  -v, --verbose    Show compilation steps');
    console.log('  --debug          Show internal debugging information');
    console.log('  --trace          Show everything (AST, IR, variable tracking)');
    console.log('  --use-ts-parser  Use TypeScript compiler API for parsing');
    console.log('  --link-tree-sitter  Link with tree-sitter for native parsing');
    console.log('  --skip-semantic-analysis  Skip semantic analysis (for self-hosting)');
    console.log('  --emit-llvm, -S  Output LLVM IR only (no binary)');
    console.log('  --keep-temps     Keep intermediate files (.ll, .o)');
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

// Default output: .build/<input-path-without-extension>
// Example: examples/hello.ts -> .build/examples/hello
//          tests/fixtures/foo.js -> .build/tests/fixtures/foo
const defaultOutput = path.join('.build', inputFile.replace(/\.(js|ts)$/, ''));
const outputFile = fileArgs[1] || defaultOutput;

// Ensure .build directory structure exists
const outputDir = path.dirname(outputFile);
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

try {
  compile(inputFile, outputFile, logLevel);
} catch (error) {
  logger.error((error as Error).message);
  process.exit(1);
}
