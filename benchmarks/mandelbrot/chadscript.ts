function mandelbrot(): void {
  const W = 4096;
  const H = 4096;
  const maxIter = 100;

  const start = Date.now();
  let totalIter = 0;

  let py = 0;
  while (py < H) {
    let px = 0;
    while (px < W) {
      const x0 = (px * 3.5) / W - 2.5;
      const y0 = (py * 2.0) / H - 1.0;
      let x = 0.0;
      let y = 0.0;
      let iter = 0;
      while (iter < maxIter && x * x + y * y <= 4.0) {
        const t = x * x - y * y + x0;
        y = 2.0 * x * y + y0;
        x = t;
        iter = iter + 1;
      }
      totalIter = totalIter + iter;
      px = px + 1;
    }
    py = py + 1;
  }

  const end = Date.now();
  const elapsed = (end - start) / 1000;
  console.log("Size:     " + W + "x" + H);
  console.log("Time:     " + elapsed + "s");
  console.log("Iters:    " + totalIter);
}

mandelbrot();
