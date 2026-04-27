function isPrime(n: number): boolean {
  if (n < 2) return false;
  if (n < 4) return true;
  if (n % 2 === 0) return false;
  let i: number = 3;
  while (i * i <= n) {
    if (n % i === 0) return false;
    i = i + 2;
  }
  return true;
}

let count: number = 0;
for (let n: number = 0; n < 1000; n++) {
  if (isPrime(n)) count++;
}
console.log(count);
