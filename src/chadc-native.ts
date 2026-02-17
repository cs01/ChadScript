import { compileNative, setSkipSemanticAnalysis, setVerbose } from './native-compiler-lib.js';
import { ArgumentParser } from '../lib/argparse.js';

declare const fs: {
  existsSync(filename: string): boolean;
};

declare const path: {
  resolve(p: string): string;
  dirname(p: string): string;
  basename(p: string): string;
};

declare const process: {
  exit(code: number): never;
  argv: string[];
};

declare const child_process: {
  execSync(command: string): number;
};

const parser = new ArgumentParser('chadc', 'compile TypeScript to native binaries via LLVM');
parser.addFlag('verbose', 'v', 'Show compilation steps');
parser.addFlag('skip-semantic-analysis', '', 'Skip semantic analysis');
parser.addOption('output', 'o', 'Specify output file', '');
parser.addPositional('input', 'Input .ts or .js file');

parser.parse(process.argv);

if (parser.getFlag('verbose')) {
  setVerbose(true);
}

if (parser.getFlag('skip-semantic-analysis')) {
  setSkipSemanticAnalysis(true);
}

const inputFile = parser.getPositional(0);
if (inputFile.length === 0) {
  console.log('Error: No input file specified');
  parser.printHelp();
  process.exit(1);
}

if (!fs.existsSync(inputFile)) {
  console.log('Error: File not found: ' + inputFile);
  process.exit(1);
}

let inputForOutput: string = inputFile;
if (inputForOutput.substr(0, 1) === '/') {
  inputForOutput = path.basename(inputForOutput);
}
let outputFile: string = '.build/' + inputForOutput;
const explicitOutput = parser.getOption('output');
if (explicitOutput.length > 0) {
  outputFile = explicitOutput;
} else if (inputForOutput.substr(inputForOutput.length - 3) === '.ts') {
  outputFile = '.build/' + inputForOutput.substr(0, inputForOutput.length - 3);
} else if (inputForOutput.substr(inputForOutput.length - 3) === '.js') {
  outputFile = '.build/' + inputForOutput.substr(0, inputForOutput.length - 3);
}

const outputDir = path.dirname(outputFile);
if (!fs.existsSync(outputDir)) {
  child_process.execSync('mkdir -p ' + outputDir);
}

compileNative(inputFile, outputFile);
