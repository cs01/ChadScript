function fib(n) {
  if (n <= 1) return n;
  return fib(n - 1) + fib(n - 2);
}

const start = performance.now();
const result = fib(42);
const elapsed = (performance.now() - start) / 1000;
console.log(`fib(42) = ${result}`);
console.log(`Time:   ${elapsed.toFixed(3)}s`);
