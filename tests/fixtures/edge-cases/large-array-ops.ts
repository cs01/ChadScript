const big: number[] = [];
for (let i = 0; i < 10000; i++) {
  big.push(i);
}

if (big.length !== 10000) {
  process.exit(1);
}

if (big[0] !== 0) {
  process.exit(1);
}
if (big[9999] !== 9999) {
  process.exit(1);
}

const sum = big.reduce((acc: number, n: number) => acc + n, 0);
if (sum !== 49995000) {
  process.exit(1);
}

const evens = big.filter((n: number) => n % 2 === 0);
if (evens.length !== 5000) {
  process.exit(1);
}

const found = big.find((n: number) => n === 7777);
if (found !== 7777) {
  process.exit(1);
}

const idx = big.indexOf(5000);
if (idx !== 5000) {
  process.exit(1);
}

const sliced = big.slice(100, 110);
if (sliced.length !== 10) {
  process.exit(1);
}
if (sliced[0] !== 100) {
  process.exit(1);
}

const rev = sliced.slice(0, sliced.length);
rev.reverse();
if (rev[0] !== 109) {
  process.exit(1);
}

console.log("TEST_PASSED");
