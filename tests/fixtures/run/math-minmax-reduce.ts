const scores = [45, 92, 78, 88, 60];
let best = scores[0] ?? 0;
let worst = scores[0] ?? 0;
for (const s of scores) {
  best = Math.max(best, s);
  worst = Math.min(worst, s);
}
console.log(best, worst);
