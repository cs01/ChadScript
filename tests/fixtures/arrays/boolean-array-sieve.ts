const limit = 50;
const sieve: boolean[] = [];
let i = 0;
while (i < limit) {
  sieve.push(true);
  i = i + 1;
}
sieve[0] = false;
sieve[1] = false;

i = 2;
while (i * i < limit) {
  if (sieve[i]) {
    let j = i * i;
    while (j < limit) {
      sieve[j] = false;
      j = j + i;
    }
  }
  i = i + 1;
}

let primes = "";
i = 2;
while (i < limit) {
  if (sieve[i]) {
    if (primes.length > 0) {
      primes = primes + ",";
    }
    primes = primes + i.toString();
  }
  i = i + 1;
}

if (primes === "2,3,5,7,11,13,17,19,23,29,31,37,41,43,47") {
  console.log("TEST_PASSED");
} else {
  console.log("FAIL: " + primes);
}
