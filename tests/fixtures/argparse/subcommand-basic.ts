import { ArgumentParser } from '../../../lib/argparse.js';

const parser = new ArgumentParser('myapp', 'test subcommands');
parser.addSubcommand('build', 'Build the project');
parser.addSubcommand('run', 'Run the project');
parser.addSubcommand('clean', 'Clean build artifacts');

parser.addFlag('verbose', 'v', 'Enable verbose output');
parser.addScopedOption('output', 'o', 'Output file', '', 'build,run');
parser.addPositional('input', 'Input file');

parser.parse(process.argv);

const cmd = parser.getSubcommand();
if (cmd === 'build') {
  const inp = parser.getPositional(0);
  const out = parser.getOption('output');
  if (out.length > 0) {
    console.log('build:' + inp + ':' + out);
  } else {
    console.log('build:' + inp);
  }
} else if (cmd === 'run') {
  const inp = parser.getPositional(0);
  console.log('run:' + inp);
} else if (cmd === 'clean') {
  console.log('clean');
} else {
  console.log('none');
}

if (parser.getFlag('verbose')) {
  console.log('verbose');
}

console.log('TEST_PASSED');
process.exit(0);
