import { ArgumentParser } from '../../lib/argparse.js';

console.log("Creating parser...");
const parser = new ArgumentParser('test', 'Test');
console.log("Adding positional...");
parser.addPositional('input', 'Input file');
console.log("Calling parse...");
parser.parse(process.argv);
console.log("Parse done");
console.log("parsedPositionals.length: " + parser.parsedPositionals.length);
