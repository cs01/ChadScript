// @category: cli
// @args: 4 8 15 16 23 42 8 4 8 x 16.5
// A command-line statistics tool: reads numbers from arguments (skipping bad ones with a
// warning), prints summary statistics, quartiles, the mode, and an ASCII histogram.

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = sorted[lo] as number;
  const b = sorted[hi] as number;
  return a + (b - a) * (pos - lo);
}

function modes(xs: number[]): number[] {
  const counts = new Map<number, number>();
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
  const best = Math.max(...counts.values());
  return [...counts.entries()]
    .filter(([, c]) => c === best)
    .map(([v]) => v)
    .sort((a, b) => a - b);
}

function histogram(xs: number[], bins: number): string[] {
  const min = Math.min(...xs);
  const max = Math.max(...xs);
  const width = (max - min) / bins || 1;
  const counts = new Array<number>(bins).fill(0);
  for (const x of xs) {
    const i = Math.min(bins - 1, Math.floor((x - min) / width));
    counts[i] = (counts[i] ?? 0) + 1;
  }
  return counts.map((c, i) => {
    const lo = min + i * width;
    return `[${lo.toFixed(1).padStart(5)}, ${(lo + width).toFixed(1).padStart(5)}) ${"#".repeat(c)} ${c}`;
  });
}

const values: number[] = [];
for (const arg of process.argv.slice(2)) {
  const n = Number(arg);
  if (arg.trim() === "" || Number.isNaN(n)) {
    console.log(`warning: skipping non-numeric argument ${JSON.stringify(arg)}`);
    continue;
  }
  values.push(n);
}
if (values.length === 0) {
  console.log("usage: stats <number>...");
  process.exit(1);
}

const sorted = [...values].sort((a, b) => a - b);
const sum = values.reduce((a, b) => a + b, 0);
const mean = sum / values.length;
const variance = values.reduce((acc, x) => acc + (x - mean) ** 2, 0) / (values.length - 1);
console.log(`n        ${values.length}`);
console.log(`sum      ${sum}`);
console.log(`min/max  ${sorted[0]} / ${sorted[sorted.length - 1]}`);
console.log(`mean     ${mean.toFixed(4)}`);
console.log(`stdev    ${Math.sqrt(variance).toFixed(4)}`);
console.log(`q1/q2/q3 ${[0.25, 0.5, 0.75].map((q) => quantile(sorted, q)).join(" / ")}`);
console.log(`mode     ${modes(values).join(", ")}`);
console.log(histogram(values, 4).join("\n"));
