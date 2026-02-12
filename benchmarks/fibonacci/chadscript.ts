function fib(n: number): number {
  if (n <= 1) return n;
  return fib(n - 1) + fib(n - 2);
}

const start = Date.now();
const result = fib(42);
const elapsed = (Date.now() - start) / 1000;
console.log("fib(42) = " + result);
console.log("Time:   " + elapsed + "s");
