// Monte Carlo pi: a pure f64 loop with an LCG (no Math.random — the subset has no RNG, and a
// fixed sequence is what makes the three languages comparable anyway).
const SAMPLES = 20000000;

function montecarlo(): number {
  let seed = 42;
  let inside = 0;
  let i = 0;
  while (i < SAMPLES) {
    seed = (seed * 16807) % 2147483647;
    const x = seed / 2147483647;
    seed = (seed * 16807) % 2147483647;
    const y = seed / 2147483647;
    if (x * x + y * y <= 1.0) inside = inside + 1;
    i = i + 1;
  }
  return (4.0 * inside) / SAMPLES;
}

console.log(montecarlo());
