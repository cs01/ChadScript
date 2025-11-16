// Test comprehensive for...of support

function testNumericArray() {
  const numbers = [10, 20, 30, 40];

  for (const n of numbers) {
    console.log(n);
  }
}

function testStringArray() {
  const words: string[] = ['hello', 'world', 'from', 'chadscript'];

  for (const word of words) {
    console.log(word);
  }
}

function testWithBreak() {
  const values = [1, 2, 3, 4, 5];

  for (const val of values) {
    if (val === 3) {
      break;
    }
    console.log(val);
  }
}

console.log('=== Numeric Array ===');
testNumericArray();

console.log('=== String Array ===');
testStringArray();

console.log('=== With Break ===');
testWithBreak();
