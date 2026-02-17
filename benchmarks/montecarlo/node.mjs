const SAMPLES = 50000000;

let seed = 42;
let inside = 0;

const start = performance.now();

for (let i = 0; i < SAMPLES; i++) {
  seed = (seed * 16807) % 2147483647;
  const x = seed / 2147483647;
  seed = (seed * 16807) % 2147483647;
  const y = seed / 2147483647;
  if (x * x + y * y <= 1.0) {
    inside++;
  }
}

const elapsed = (performance.now() - start) / 1000;
const pi = 4.0 * inside / SAMPLES;

console.log(`Samples:  ${SAMPLES}`);
console.log(`Pi:       ${pi}`);
console.log(`Time:     ${elapsed.toFixed(3)}s`);
