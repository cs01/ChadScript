// Simplest possible if test
const x = 0;

if (x === 0) {
  console.log("x is zero");
  process.exit(10);
}

console.log("x is NOT zero");
process.exit(1);
