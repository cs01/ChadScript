const content = ChadScript.embedFile('./embed-test-data.txt');

const lines = content.split('\n');
if (lines.length < 3) {
  console.log('FAIL: expected at least 3 lines');
  process.exit(1);
}

if (lines[0] !== 'Hello from embedded file!') {
  console.log('FAIL: first line mismatch');
  process.exit(1);
}

if (lines[2] !== 'Line 3 of the test data.') {
  console.log('FAIL: third line mismatch');
  process.exit(1);
}

console.log('TEST_PASSED');
