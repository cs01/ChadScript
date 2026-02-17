const SAMPLES = 50000000;

function montecarlo(): void {
  let seed = 42;
  let inside = 0;
  let i = 0;

  const start = Date.now();

  while (i < SAMPLES) {
    seed = (seed * 16807) % 2147483647;
    const x = seed / 2147483647;
    seed = (seed * 16807) % 2147483647;
    const y = seed / 2147483647;
    if (x * x + y * y <= 1.0) {
      inside = inside + 1;
    }
    i = i + 1;
  }

  const end = Date.now();
  const elapsed = (end - start) / 1000;
  const pi = 4.0 * inside / SAMPLES;

  console.log("Samples:  " + SAMPLES);
  console.log("Pi:       " + pi);
  console.log("Time:     " + elapsed + "s");
}

montecarlo();
