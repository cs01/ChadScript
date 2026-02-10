// Test comprehensive for...of support

function testNumericArray(): boolean {
  const numbers = [10, 20, 30, 40];
  let sum = 0;

  for (const n of numbers) {
    sum = sum + n;
  }

  if (sum !== 100) {
    console.log('FAIL: numeric sum expected 100 got ' + sum);
    return false;
  }
  return true;
}

function testStringArray(): boolean {
  const words: string[] = ['hello', 'world'];
  let result = '';

  for (const word of words) {
    result = result + word + ' ';
  }

  if (result !== 'hello world ') {
    console.log('FAIL: string concat expected "hello world " got "' + result + '"');
    return false;
  }
  return true;
}

function testWithBreak(): boolean {
  const values = [1, 2, 3, 4, 5];
  let sum = 0;

  for (const val of values) {
    if (val === 4) {
      break;
    }
    sum = sum + val;
  }

  if (sum !== 6) {
    console.log('FAIL: break sum expected 6 got ' + sum);
    return false;
  }
  return true;
}

let passed = true;
if (!testNumericArray()) { passed = false; }
if (!testStringArray()) { passed = false; }
if (!testWithBreak()) { passed = false; }

if (passed) {
  console.log('TEST_PASSED');
}
