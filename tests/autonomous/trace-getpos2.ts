import { ArgumentParser } from '../../lib/argparse.js';

const parser = new ArgumentParser('test', 'Test');
parser.addPositional('input', 'Input file');
parser.parse(process.argv);

console.log("length: " + parser.parsedPositionals.length);
let i = 0;
while (i < parser.parsedPositionals.length) {
  const item = parser.parsedPositionals[i];
  console.log("item " + i + ": " + item);
  i = i + 1;
}
const direct = parser.parsedPositionals[0];
console.log("direct access: " + direct);
console.log("direct.length: " + direct.length);
