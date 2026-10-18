// toFixed over a dense grid, so decimal ties (k * 0.005) and their binary near-misses are
// exercised broadly at every precision 0..4, plus powers of ten and of two.
let line = "";
for (let i = 0; i <= 400; i++) {
  const x = i * 0.005;
  line = "";
  for (let d = 0; d <= 4; d++) line = line + " " + x.toFixed(d) + " " + (-x).toFixed(d);
  console.log(i, line);
}
for (let e = -12; e <= 22; e++) {
  const p = Math.pow(10, e);
  console.log(e, p.toFixed(0), p.toFixed(3), (p * 1.5).toFixed(2), (p / 3).toFixed(10));
}
let t = 1;
for (let e = 0; e < 75; e++) {
  console.log(e, t.toFixed(0), (1 / t).toFixed(30), (t + 0.5).toFixed(0));
  t = t * 2;
}
