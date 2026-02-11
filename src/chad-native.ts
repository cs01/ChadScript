import { compileNative, setSkipSemanticAnalysis, setEmitLLVMOnly } from './native-compiler-lib.js';

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

const VERSION = '0.1.0';

function printHelp(): void {
  console.log('chad - compile TypeScript to native binaries via LLVM');
  console.log('');
  console.log('Usage: chad <command> [options] <file>');
  console.log('');
  console.log('Commands:');
  console.log('  build <file>     Compile to a native binary');
  console.log('  run <file>       Compile and run');
  console.log('  ir <file>        Emit LLVM IR only');
  console.log('  clean            Remove the .build directory');
  console.log('');
  console.log('Options:');
  console.log('  -o <output>                 Specify output file');
  console.log('  --skip-semantic-analysis    Skip semantic analysis');
  console.log('  -h, --help                  Show this help message');
  console.log('  --version                   Show version');
  console.log('');
  console.log('Examples:');
  console.log('  chad build hello.ts');
  console.log('  chad build hello.ts -o myapp');
  console.log('  chad run hello.ts');
  console.log('  chad ir hello.ts');
}

function printVersion(): void {
  console.log('chad ' + VERSION);
}

const args = process.argv;

if (args.length < 1) {
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

if (command === 'clean') {
  if (fs.existsSync('.build')) {
    child_process.execSync('rm -rf .build');
    console.log('removed .build');
  }
  process.exit(0);
}

if (command !== 'build' && command !== 'run' && command !== 'ir') {
  const endsWithTs = command.substr(command.length - 3) === '.ts';
  const endsWithJs = command.substr(command.length - 3) === '.js';
  if (endsWithTs || endsWithJs) {
    console.log('chad: error: missing command. did you mean chad build ' + command + '?');
  } else {
    console.log('chad: error: unknown command ' + command);
  }
  console.log('Run chad --help for usage');
  process.exit(1);
}

let inputFile: string | null = null;
let outputFile: string | null = null;
let argIdx = 1;
while (argIdx < args.length) {
  const arg = args[argIdx];
  if (arg === '-h' || arg === '--help') {
    printHelp();
    process.exit(0);
  } else if (arg === '--version') {
    printVersion();
    process.exit(0);
  } else if (arg === '--skip-semantic-analysis') {
    setSkipSemanticAnalysis(true);
    argIdx = argIdx + 1;
  } else if (arg === '-o') {
    argIdx = argIdx + 1;
    if (argIdx < args.length) {
      outputFile = args[argIdx];
      argIdx = argIdx + 1;
    }
  } else if (arg.substr(0, 1) === '-') {
    console.log('chad: error: unknown option ' + arg);
    console.log('Run chad --help for usage');
    process.exit(1);
  } else if (inputFile === null) {
    inputFile = arg;
    argIdx = argIdx + 1;
  } else {
    argIdx = argIdx + 1;
  }
}

if (inputFile === null) {
  console.log('chad: error: no input files');
  console.log('Usage: chad ' + command + ' [options] <input.ts>');
  process.exit(1);
  throw new Error('unreachable');
}

let theInputFile: string = '';
theInputFile = inputFile;

if (!fs.existsSync(theInputFile)) {
  console.log('chad: error: file not found: ' + theInputFile);
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

if (command === 'ir') {
  setEmitLLVMOnly(true);
}

compileNative(theInputFile, theOutputFile);

if (command === 'run') {
  const binPath = path.resolve(theOutputFile);
  if (!fs.existsSync(binPath)) {
    console.log('chad: error: compilation produced no binary');
    process.exit(1);
  }
  child_process.execSync(binPath);
}
