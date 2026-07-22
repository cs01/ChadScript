// Classic FizzBuzz — control flow, string building, the ternary/`%` operators.
function fizzbuzz(n: number): string {
  if (n % 15 === 0) return "FizzBuzz";
  if (n % 3 === 0) return "Fizz";
  if (n % 5 === 0) return "Buzz";
  return String(n);
}

for (let i = 1; i <= 20; i++) {
  console.log(fizzbuzz(i));
}
