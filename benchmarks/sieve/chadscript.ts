const LIMIT = 10000000;

function sieve(): void {
  const flags = new Uint8Array(LIMIT + 1);
  let i = 0;
  while (i <= LIMIT) {
    flags[i] = 1;
    i = i + 1;
  }

  const start = Date.now();

  flags[0] = 0;
  flags[1] = 0;
  let p = 2;
  while (p * p <= LIMIT) {
    if (flags[p] === 1) {
      let m = p * p;
      while (m <= LIMIT) {
        flags[m] = 0;
        m = m + p;
      }
    }
    p = p + 1;
  }

  let count = 0;
  let j = 0;
  while (j <= LIMIT) {
    if (flags[j] === 1) {
      count = count + 1;
    }
    j = j + 1;
  }

  const elapsed = (Date.now() - start) / 1000;
  console.log("Limit:    " + LIMIT);
  console.log("Primes:   " + count);
  console.log("Time:     " + elapsed + "s");
}

sieve();
