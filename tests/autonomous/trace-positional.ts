import { ArgumentParser } from '../../lib/argparse.js';

console.log("argc: " + process.argv.length);
let i = 0;
while (i < process.argv.length) {
  console.log("argv[" + i + "]: " + process.argv[i]);
  i = i + 1;
}

const parser = new ArgumentParser('test', 'Test');
parser.addFlag('verbose', 'v', 'Verbose');
parser.addPositional('input', 'Input file');

parser.parse(process.argv);

console.log("parsedPositionals.length: " + parser.parsedPositionals.length);
let j = 0;
while (j < parser.parsedPositionals.length) {
  console.log("pos[" + j + "]: " + parser.parsedPositionals[j]);
  j = j + 1;
}

const input = parser.getPositional(0);
console.log("input: " + input);
console.log("input.length: " + input.length);
