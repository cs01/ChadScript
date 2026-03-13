function factorial(n: number): number {
  if (n <= 1) return 1;
  return n * factorial(n - 1);
}

if (factorial(0) !== 1) process.exit(1);
if (factorial(1) !== 1) process.exit(1);
if (factorial(5) !== 120) process.exit(1);
if (factorial(10) !== 3628800) process.exit(1);

function fib(n: number): number {
  if (n <= 1) return n;
  return fib(n - 1) + fib(n - 2);
}

if (fib(0) !== 0) process.exit(1);
if (fib(1) !== 1) process.exit(1);
if (fib(10) !== 55) process.exit(1);
if (fib(15) !== 610) process.exit(1);

console.log("TEST_PASSED");
