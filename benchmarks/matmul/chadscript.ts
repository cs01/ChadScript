function matmul(): void {
  const N = 512;
  const a: number[] = [];
  const b: number[] = [];
  const c: number[] = [];

  let i = 0;
  while (i < N * N) {
    a.push((i % N) + 0.1);
    b.push((i / N) + 0.1);
    c.push(0);
    i = i + 1;
  }

  const start = Date.now();

  let row = 0;
  while (row < N) {
    let col = 0;
    while (col < N) {
      let sum = 0.0;
      let k = 0;
      while (k < N) {
        sum = sum + a[row * N + k] * b[k * N + col];
        k = k + 1;
      }
      c[row * N + col] = sum;
      col = col + 1;
    }
    row = row + 1;
  }

  const end = Date.now();
  const elapsed = (end - start) / 1000;
  console.log("Size:     " + N + "x" + N);
  console.log("Time:     " + elapsed + "s");
  console.log("Check:    " + c[0]);
}

matmul();
