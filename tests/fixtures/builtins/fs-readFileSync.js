import * as fs from 'fs';

function test() {
  const contents = fs.readFileSync('tests/fixtures/test.txt', 'utf8');
  console.log(contents);
  return 0;
}

process.exit(test());
