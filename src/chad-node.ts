#!/usr/bin/env node

import { compile, setSkipSemanticAnalysis, setKeepTemps, setEmitLLVMOnly, setSanitize, setDebugInfo } from './compiler.js';
import { LogLevel, logger } from './utils/logger.js';
import { runInit } from './codegen/stdlib/init-templates.js';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';

const args = process.argv.slice(2);

function printVersion(): void {
  const packageJsonPath = path.join(import.meta.dirname || process.cwd(), '..', 'package.json');
  try {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    console.log(`chad ${pkg.version}`);
  } catch {
    console.log('chad 0.1.0');
  }
}

function printHelp(): void {
  console.log('chad - compile TypeScript to native binaries via LLVM');
  console.log('');
  console.log('Usage: chad <command> [options] <file>');
  console.log('');
  console.log('Commands:');
  console.log('  build <file>     Compile to a native binary');
  console.log('  run <file>       Compile and run');
  console.log('  ir <file>        Emit LLVM IR only');
  console.log('  init             Generate starter project (chadscript.d.ts, tsconfig.json, hello.ts)');
  console.log('  clean            Remove the .build directory');
  console.log('');
  console.log('Options:');
  console.log('  -o <output>                 Specify output file');
  console.log('  -v, --verbose               Show compilation steps');
  console.log('  --debug                     Show internal debugging information');
  console.log('  --trace                     Show everything (AST, IR, variable tracking)');
  console.log('  --skip-semantic-analysis    Skip semantic analysis');
  console.log('  --keep-temps                Keep intermediate files (.ll, .o)');
  console.log('  -fsanitize=address          Build with AddressSanitizer');
  console.log('  -g                          Emit DWARF debug info for source-level debugging');
  console.log('  -h, --help                  Show this help message');
  console.log('  --version                   Show version');
  console.log('');
  console.log('Examples:');
  console.log('  chad build hello.ts');
  console.log('  chad build hello.ts -o myapp');
  console.log('  chad run hello.ts');
  console.log('  chad run hello.ts -- arg1 arg2');
  console.log('  chad ir hello.ts');
}

if (args.length === 0) {
  printHelp();
  process.exit(0);
}

const command = args[0];

if (command === '-h' || command === '--help') {
  printHelp();
  process.exit(0);
}

if (command === '--version') {
  printVersion();
  process.exit(0);
}

if (command === 'init') {
  runInit();
  process.exit(0);
}

if (command === 'clean') {
  const buildDir = path.resolve('.build');
  if (fs.existsSync(buildDir)) {
    fs.rmSync(buildDir, { recursive: true });
    console.log('removed .build');
  }
  process.exit(0);
}

if (command !== 'build' && command !== 'run' && command !== 'ir' && command !== 'init') {
  if (command.endsWith('.ts') || command.endsWith('.js')) {
    console.error(`chad: error: missing command. did you mean 'chad build ${command}'?`);
  } else {
    console.error(`chad: error: unknown command '${command}'`);
  }
  console.error('Run chad --help for usage');
  process.exit(1);
}

const subArgs = args.slice(1);
let logLevel = LogLevel.Normal;
const fileArgs: string[] = [];
let skipNextArg = false;
let outputArg: string | null = null;
let dashdashIndex = -1;

for (let i = 0; i < subArgs.length; i++) {
  const arg = subArgs[i];
  if (skipNextArg) {
    skipNextArg = false;
    continue;
  }
  if (arg === '--') {
    dashdashIndex = i;
    break;
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
  } else if (arg === '-fsanitize=address' || arg === '--sanitize=address') {
    setSanitize('address');
  } else if (arg === '-g') {
    setDebugInfo(true);
  } else if (arg === '-o') {
    if (i + 1 < subArgs.length) {
      outputArg = subArgs[i + 1];
      skipNextArg = true;
    }
  } else if (arg === '-h' || arg === '--help') {
    printHelp();
    process.exit(0);
  } else {
    fileArgs.push(arg);
  }
}

const runArgs = dashdashIndex >= 0 ? subArgs.slice(dashdashIndex + 1) : [];

if (command === 'ir') {
  setEmitLLVMOnly(true);
  setKeepTemps(true);
}

if (fileArgs.length < 1) {
  console.error('chad: error: no input files');
  console.error(`Usage: chad ${command} [options] <input.ts|.js>`);
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

if (command === 'run') {
  const bin = path.resolve(outputFile);
  if (!fs.existsSync(bin)) {
    logger.error('chad: error: compilation produced no binary');
    process.exit(1);
  }
  try {
    const runCmd = [bin, ...runArgs].map(a => `"${a}"`).join(' ');
    execSync(runCmd, { stdio: 'inherit' });
  } catch (error) {
    const err = error as { status?: number };
    process.exit(err.status ?? 1);
  }
}
