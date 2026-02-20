const N = 512;
const a = new Float64Array(N * N);
const b = new Float64Array(N * N);
const c = new Float64Array(N * N);

for (let i = 0; i < N * N; i++) {
  a[i] = (i % N) + 0.1;
  b[i] = i / N + 0.1;
}

const start = performance.now();

for (let row = 0; row < N; row++) {
  for (let col = 0; col < N; col++) {
    let sum = 0;
    for (let k = 0; k < N; k++) {
      sum += a[row * N + k] * b[k * N + col];
    }
    c[row * N + col] = sum;
  }
}

const elapsed = (performance.now() - start) / 1000;
const gflops = (2 * N * N * N) / elapsed / 1e9;
console.log(`Size:     ${N}x${N}`);
console.log(`Time:     ${elapsed.toFixed(3)}s`);
console.log(`GFLOPS:   ${gflops.toFixed(2)}`);
