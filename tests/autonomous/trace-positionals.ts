import { ArgumentParser } from '../../lib/argparse.js';

const parser = new ArgumentParser('test', 'Test');
parser.addPositional('input', 'Input file');
parser.parse(process.argv);

console.log("Count: " + parser.parsedPositionals.length);
let j = 0;
while (j < parser.parsedPositionals.length) {
  console.log("item[" + j + "]: " + parser.parsedPositionals[j]);
  j = j + 1;
}
