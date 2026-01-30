import { ArgumentParser } from '../../lib/argparse.js';

const parser = new ArgumentParser('test', 'Test');
parser.addPositional('input', 'Input file');

console.log("Before parse");
console.log("argNames.length: " + parser.argNames.length);

const argv = process.argv;
console.log("argv.length: " + argv.length);

let argIdx = 1;
while (argIdx < argv.length) {
  console.log("Processing idx " + argIdx);
  const currentArg = argv[argIdx];
  console.log("currentArg: " + currentArg);
  const firstChar = currentArg.charAt(0);
  console.log("firstChar: " + firstChar);
  if (currentArg.length > 0 && firstChar === "-") {
    console.log("Is flag/option");
  } else {
    console.log("Is positional");
    parser.parsedPositionals.push(currentArg);
    console.log("Pushed, now length: " + parser.parsedPositionals.length);
  }
  argIdx = argIdx + 1;
}

console.log("Final positionals: " + parser.parsedPositionals.length);
