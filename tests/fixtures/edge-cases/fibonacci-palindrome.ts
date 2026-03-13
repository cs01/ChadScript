function fibonacci(n: number): number {
  if (n <= 1) return n;
  let a = 0;
  let b = 1;
  for (let i = 2; i <= n; i++) {
    const temp = a + b;
    a = b;
    b = temp;
  }
  return b;
}

if (fibonacci(0) !== 0) process.exit(1);
if (fibonacci(1) !== 1) process.exit(1);
if (fibonacci(10) !== 55) process.exit(1);
if (fibonacci(20) !== 6765) process.exit(1);

function isPalindrome(s: string): boolean {
  const len = s.length;
  for (let i = 0; i < len / 2; i++) {
    if (s.charAt(i) !== s.charAt(len - 1 - i)) return false;
  }
  return true;
}

if (!isPalindrome("racecar")) process.exit(1);
if (!isPalindrome("a")) process.exit(1);
if (!isPalindrome("")) process.exit(1);
if (isPalindrome("hello")) process.exit(1);

console.log("TEST_PASSED");
