function estimatePi(iterations: number): number {
  let inside: number = 0;
  let seed: number = 42;
  for (let i: number = 0; i < iterations; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const x: number = (seed / 0x7fffffff) * 2 - 1;
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const y: number = (seed / 0x7fffffff) * 2 - 1;
    if (x * x + y * y <= 1) inside++;
  }
  return (4 * inside) / iterations;
}

console.log(estimatePi(100000));
