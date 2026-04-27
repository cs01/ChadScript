function min(a: number, b: number): number {
  if (a < b) return a;
  return b;
}

function max(a: number, b: number): number {
  if (a > b) return a;
  return b;
}

function clamp(val: number, lo: number, hi: number): number {
  return min(max(val, lo), hi);
}

console.log(clamp(15, 0, 10));
console.log(clamp(-5, 0, 10));
console.log(clamp(5, 0, 10));
