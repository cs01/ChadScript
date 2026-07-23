// Sieve of Eratosthenes: array indexing and tight loops.
function countPrimes(limit: number): number {
  const sieve: boolean[] = [];
  for (let i = 0; i <= limit; i++) sieve.push(true);
  let count = 0;
  for (let i = 2; i <= limit; i++) {
    if (sieve[i] ?? false) {
      count++;
      for (let j = i * i; j <= limit; j += i) sieve[j] = false;
    }
  }
  return count;
}

console.log(countPrimes(5000000));
