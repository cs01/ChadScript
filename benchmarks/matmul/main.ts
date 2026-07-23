// Dense matrix multiply: nested array indexing, f64 multiply-accumulate.
function matmul(n: number): number {
  const a: number[] = [];
  const b: number[] = [];
  for (let i = 0; i < n * n; i++) {
    a.push((i % 7) + 1);
    b.push((i % 5) + 1);
  }
  const c: number[] = [];
  for (let i = 0; i < n * n; i++) c.push(0);

  for (let i = 0; i < n; i++) {
    for (let k = 0; k < n; k++) {
      const aik = a[i * n + k] ?? 0;
      for (let j = 0; j < n; j++) {
        c[i * n + j] = (c[i * n + j] ?? 0) + aik * (b[k * n + j] ?? 0);
      }
    }
  }
  let sum = 0;
  for (const v of c) sum += v;
  return sum;
}

console.log(matmul(320));
