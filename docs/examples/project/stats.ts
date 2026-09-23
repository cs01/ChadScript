export function mean(xs: number[]): number {
  let sum = 0;
  for (const x of xs) sum += x;
  return xs.length === 0 ? 0 : sum / xs.length;
}

export function median(xs: number[]): number {
  const sorted = [...xs].sort((a: number, b: number): number => a - b);
  const mid = Math.floor(sorted.length / 2);
  const hi = sorted[mid] ?? 0;
  if (sorted.length % 2 === 1) return hi;
  const lo = sorted[mid - 1] ?? 0;
  return (lo + hi) / 2;
}
