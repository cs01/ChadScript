// @category: algorithms
// Number theory helpers: sieve of Eratosthenes, trial-division factorization, gcd/lcm, modular
// exponentiation, Miller-Rabin for small numbers, and perfect numbers.

function sieve(limit: number): number[] {
  const composite: boolean[] = [];
  for (let i = 0; i <= limit; i++) composite.push(false);
  const primes: number[] = [];
  for (let i = 2; i <= limit; i++) {
    if (composite[i]) continue;
    primes.push(i);
    for (let j = i * i; j <= limit; j += i) composite[j] = true;
  }
  return primes;
}

function factorize(n: number): Map<number, number> {
  const factors = new Map<number, number>();
  let d = 2;
  while (d * d <= n) {
    while (n % d === 0) {
      factors.set(d, (factors.get(d) || 0) + 1);
      n = n / d;
    }
    d++;
  }
  if (n > 1) factors.set(n, (factors.get(n) || 0) + 1);
  return factors;
}

function formatFactors(factors: Map<number, number>): string {
  const parts: string[] = [];
  factors.forEach((exp, p) => {
    parts.push(exp > 1 ? p + "^" + exp : String(p));
  });
  return parts.join(" * ");
}

function gcd(a: number, b: number): number {
  while (b !== 0) {
    const t = b;
    b = a % b;
    a = t;
  }
  return Math.abs(a);
}

function lcm(a: number, b: number): number {
  return (a / gcd(a, b)) * b;
}

function modPow(base: number, exp: number, mod: number): number {
  let result = 1;
  base = base % mod;
  while (exp > 0) {
    if (exp % 2 === 1) result = (result * base) % mod;
    base = (base * base) % mod;
    exp = Math.floor(exp / 2);
  }
  return result;
}

function isProbablePrime(n: number): boolean {
  if (n < 2) return false;
  const small = [2, 3, 5, 7];
  for (const p of small) {
    if (n === p) return true;
    if (n % p === 0) return false;
  }
  let d = n - 1;
  let r = 0;
  while (d % 2 === 0) {
    d = d / 2;
    r++;
  }
  for (const a of small) {
    let x = modPow(a, d, n);
    if (x === 1 || x === n - 1) continue;
    let composite = true;
    for (let i = 1; i < r; i++) {
      x = (x * x) % n;
      if (x === n - 1) {
        composite = false;
        break;
      }
    }
    if (composite) return false;
  }
  return true;
}

function sumOfDivisors(n: number): number {
  let sum = 1;
  for (let i = 2; i * i <= n; i++) {
    if (n % i === 0) {
      sum += i;
      if (i * i !== n) sum += n / i;
    }
  }
  return sum;
}

const primes = sieve(100);
console.log("primes <= 100:", primes.length);
console.log(primes.join(" "));
for (const n of [360, 97, 1001, 65536, 999999, 123456789]) {
  console.log(n + " = " + formatFactors(factorize(n)));
}
console.log(
  "gcd(84, 36) =",
  gcd(84, 36),
  "lcm(4, 6) =",
  lcm(4, 6),
  "lcm(1..20) =",
  [...Array(20).keys()].map((i) => i + 1).reduce(lcm),
);
console.log("3^200 mod 13 =", modPow(3, 200, 13), " 2^10 mod 1000 =", modPow(2, 10, 1000));
const checks = [1, 2, 15, 17, 561, 7919, 7917, 104729];
console.log(checks.map((n) => n + ":" + (isProbablePrime(n) ? "prime" : "composite")).join(", "));
const perfect: number[] = [];
for (let n = 2; n < 10000; n++) if (sumOfDivisors(n) === n) perfect.push(n);
console.log("perfect numbers:", perfect);
let twin = 0;
for (let i = 1; i < primes.length; i++) if (primes[i]! - primes[i - 1]! === 2) twin++;
console.log("twin prime pairs under 100:", twin);
