import { ArgumentParser } from '../../lib/argparse.js';

const parser = new ArgumentParser('test', 'Test');
parser.addPositional('input', 'Input file');
parser.parse(process.argv);

console.log("parsedPositionals.length: " + parser.parsedPositionals.length);
const input = parser.getPositional(0);
console.log("input: " + input);
console.log("input.length: " + input.length);
if (input.length == 0) {
  console.log("Input is empty");
} else {
  console.log("Input is: " + input);
}
