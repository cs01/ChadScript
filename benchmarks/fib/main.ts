// Recursive fibonacci: function-call overhead and f64 arithmetic, nothing else.
function fib(n: number): number {
  if (n < 2) return n;
  return fib(n - 1) + fib(n - 2);
}

console.log(fib(35));
