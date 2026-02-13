const LIMIT = 10000000;

const flags = new Uint8Array(LIMIT + 1).fill(1);

const start = performance.now();

flags[0] = 0;
flags[1] = 0;
for (let p = 2; p * p <= LIMIT; p++) {
  if (flags[p]) {
    for (let m = p * p; m <= LIMIT; m += p) {
      flags[m] = 0;
    }
  }
}

let count = 0;
for (let i = 0; i <= LIMIT; i++) {
  if (flags[i]) count++;
}

const elapsed = (performance.now() - start) / 1000;
console.log(`Limit:    ${LIMIT}`);
console.log(`Primes:   ${count}`);
console.log(`Time:     ${elapsed.toFixed(3)}s`);
