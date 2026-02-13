import { compileNative, setSkipSemanticAnalysis, setVerbose, setLinkTreeSitter } from './native-compiler-lib.js';

declare const fs: {
  existsSync(filename: string): boolean;
};

declare const path: {
  resolve(p: string): string;
  dirname(p: string): string;
  basename(p: string): string;
};

declare const process: {
  exit(code: number): void;
  argv: string[];
};

declare const child_process: {
  execSync(command: string): number;
};

function printUsage(): void {
  console.log('chadc - compile TypeScript to native binaries via LLVM');
  console.log('');
  console.log('Usage: chadc [options] <input.ts> [output]');
  console.log('');
  console.log('Options:');
  console.log('  -o <output>               Specify output file (default: .build/<input>)');
  console.log('  -v, --verbose             Show compilation steps');
  console.log('  --skip-semantic-analysis  Skip semantic analysis');
  console.log('  --link-tree-sitter        Link with tree-sitter for native parsing');
  console.log('  --help, -h                Show this help message');
}

const args = process.argv;

if (args.length < 1) {
  printUsage();
  process.exit(1);
}

let inputFile: string | null = null;
let outputFile: string | null = null;
let wantSkipSemantic = false;
let wantVerbose = false;
let wantLinkTreeSitter = false;
let argIdx = 0;
while (argIdx < args.length) {
  const arg = args[argIdx];
  if (arg === '--help' || arg === '-h') {
    printUsage();
    process.exit(0);
  } else if (arg === '--skip-semantic-analysis') {
    wantSkipSemantic = true;
    argIdx = argIdx + 1;
  } else if (arg === '-v' || arg === '--verbose') {
    wantVerbose = true;
    argIdx = argIdx + 1;
  } else if (arg === '--link-tree-sitter') {
    wantLinkTreeSitter = true;
    argIdx = argIdx + 1;
  } else if (arg === '-o') {
    argIdx = argIdx + 1;
    if (argIdx < args.length) {
      outputFile = args[argIdx];
      argIdx = argIdx + 1;
    }
  } else if (arg.substr(0, 1) === '-') {
    console.log('Unknown option: ' + arg);
    printUsage();
    process.exit(1);
  } else if (inputFile === null) {
    inputFile = arg;
    argIdx = argIdx + 1;
  } else if (outputFile === null) {
    outputFile = arg;
    argIdx = argIdx + 1;
  } else {
    argIdx = argIdx + 1;
  }
}

if (wantSkipSemantic) {
  setSkipSemanticAnalysis(true);
}

if (wantVerbose) {
  setVerbose(true);
}

if (wantLinkTreeSitter) {
  setLinkTreeSitter(true);
}

if (inputFile === null) {
  console.log('Error: No input file specified');
  printUsage();
  process.exit(1);
  throw new Error('unreachable');
}

let theInputFile: string = '';
theInputFile = inputFile;

if (!fs.existsSync(theInputFile)) {
  console.log('Error: File not found: ' + theInputFile);
  process.exit(1);
  throw new Error('unreachable');
}

let inputForOutput: string = theInputFile;
if (inputForOutput.substr(0, 1) === '/') {
  inputForOutput = path.basename(inputForOutput);
}
let theOutputFile: string = '.build/' + inputForOutput;
if (outputFile !== null) {
  theOutputFile = outputFile;
} else if (inputForOutput.substr(inputForOutput.length - 3) === '.ts') {
  theOutputFile = '.build/' + inputForOutput.substr(0, inputForOutput.length - 3);
} else if (inputForOutput.substr(inputForOutput.length - 3) === '.js') {
  theOutputFile = '.build/' + inputForOutput.substr(0, inputForOutput.length - 3);
}

const outputDir = path.dirname(theOutputFile);
if (!fs.existsSync(outputDir)) {
  child_process.execSync('mkdir -p ' + outputDir);
}

compileNative(theInputFile, theOutputFile);
