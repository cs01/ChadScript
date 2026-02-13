const W = 4096;
const H = 4096;
const maxIter = 100;

const start = performance.now();
let totalIter = 0;

for (let py = 0; py < H; py++) {
  for (let px = 0; px < W; px++) {
    const x0 = (px * 3.5) / W - 2.5;
    const y0 = (py * 2.0) / H - 1.0;
    let x = 0, y = 0, iter = 0;
    while (iter < maxIter && x * x + y * y <= 4.0) {
      const t = x * x - y * y + x0;
      y = 2.0 * x * y + y0;
      x = t;
      iter++;
    }
    totalIter += iter;
  }
}

const elapsed = (performance.now() - start) / 1000;
console.log(`Size:     ${W}x${H}`);
console.log(`Time:     ${elapsed.toFixed(3)}s`);
console.log(`Iters:    ${totalIter}`);
