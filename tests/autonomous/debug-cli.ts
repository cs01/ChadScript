import { ArgumentParser } from '../../lib/argparse.js';

console.log("process.argv.length:", process.argv.length);
let i = 0;
while (i < process.argv.length) {
  console.log("argv[" + i + "]:", process.argv[i]);
  i = i + 1;
}

const parser = new ArgumentParser('test-cli', 'Autonomous test CLI');
parser.addFlag('verbose', 'v', 'Enable verbose output');
parser.addPositional('input', 'Input file');

parser.parse(process.argv);
console.log("Positional count:", parser.parsedPositionals.length);
let idx = 0;
while (idx < parser.parsedPositionals.length) {
  console.log("positional[" + idx + "]:", parser.parsedPositionals[idx]);
  idx = idx + 1;
}

const input = parser.getPositional(0);
console.log("input value:", input);
console.log("input length:", input.length);
