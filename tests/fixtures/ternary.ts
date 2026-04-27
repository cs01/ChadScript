function abs(x: number): number {
  return x < 0 ? -x : x;
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

console.log(abs(-5));
console.log(abs(3));
console.log(clamp(10, 0, 5));
console.log(clamp(-3, 0, 5));
console.log(clamp(2, 0, 5));
