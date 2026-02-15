#!/usr/bin/env node

import { compile, setSkipSemanticAnalysis, setKeepTemps, setEmitLLVMOnly, setSanitize, setDebugInfo } from './compiler.js';
import { LogLevel, logger } from './utils/logger.js';
import * as path from 'path';
import * as fs from 'fs';

const args = process.argv.slice(2);

let logLevel = LogLevel.Normal;
const fileArgs: string[] = [];
let skipNextArg = false;
let outputArg: string | null = null;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (skipNextArg) {
    skipNextArg = false;
    continue;
  }
  if (arg === '-v' || arg === '--verbose') {
    logLevel = LogLevel.Verbose;
  } else if (arg === '--debug') {
    logLevel = LogLevel.Debug;
  } else if (arg === '--trace') {
    logLevel = LogLevel.Trace;
  } else if (arg === '--skip-semantic-analysis') {
    setSkipSemanticAnalysis(true);
  } else if (arg === '--keep-temps' || arg === '-save-temps') {
    setKeepTemps(true);
  } else if (arg === '--emit-llvm' || arg === '-S') {
    setEmitLLVMOnly(true);
  } else if (arg === '-fsanitize=address' || arg === '--sanitize=address') {
    setSanitize('address');
  } else if (arg === '-g') {
    setDebugInfo(true);
  } else if (arg === '-o') {
    if (i + 1 < args.length) {
      outputArg = args[i + 1];
      skipNextArg = true;
    }
  } else if (arg === '-h' || arg === '--help') {
    console.log('chadc - ChadScript compiler');
    console.log('');
    console.log('Usage: chadc [options] <input.ts|.js> [output]');
    console.log('');
    console.log('Options:');
    console.log('  -v, --verbose    Show compilation steps');
    console.log('  --debug          Show internal debugging information');
    console.log('  --trace          Show everything (AST, IR, variable tracking)');
    console.log('  --skip-semantic-analysis  Skip semantic analysis (for self-hosting)');
    console.log('  --emit-llvm, -S  Output LLVM IR only (no binary)');
    console.log('  --keep-temps     Keep intermediate files (.ll, .o)');
    console.log('  -fsanitize=address  Build with AddressSanitizer (ASAN)');
    console.log('  -g                 Emit DWARF debug info for source-level debugging');
    console.log('  -h, --help       Show this help message');
    console.log('');
    console.log('Examples:');
    console.log('  chadc hello.ts');
    console.log('  chadc hello.ts -o myapp');
    console.log('  chadc -v hello.ts');
    process.exit(0);
  } else {
    fileArgs.push(arg);
  }
}

if (fileArgs.length < 1) {
  logger.error('chadc: error: no input files');
  logger.error('Usage: chadc [options] <input.ts|.js> [output]');
  process.exit(1);
}

const inputFile = fileArgs[0];
const defaultOutput = path.join('.build', inputFile.replace(/\.(js|ts)$/, ''));
const outputFile = outputArg || fileArgs[1] || defaultOutput;

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
