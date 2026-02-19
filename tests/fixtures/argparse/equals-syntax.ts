import { ArgumentParser } from '../../../lib/argparse.js';

const parser = new ArgumentParser('myapp', 'test equals syntax');
parser.addSubcommand('build', 'Build the project');
parser.addOption('target-cpu', '', 'Set target CPU', 'native');
parser.addOption('output', 'o', 'Output file', '');
parser.addPositional('input', 'Input file');

parser.parse(process.argv);

const cmd = parser.getSubcommand();
console.log('cmd:' + cmd);

const cpu = parser.getOption('target-cpu');
console.log('cpu:' + cpu);

const out = parser.getOption('output');
if (out.length > 0) {
  console.log('output:' + out);
}

const inp = parser.getPositional(0);
console.log('input:' + inp);

console.log('TEST_PASSED');
process.exit(0);
