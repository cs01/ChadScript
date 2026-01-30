import { ArgumentParser } from '../../lib/argparse.js';

const parser = new ArgumentParser('test', 'Test');
parser.addPositional('input', 'Input file');
parser.parse(process.argv);

console.log("length: " + parser.parsedPositionals.length);
const direct = parser.parsedPositionals[0];
console.log("done");
