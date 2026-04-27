function isInRange(x: number, lo: number, hi: number): boolean {
  return x >= lo && x <= hi;
}

function isOutOfRange(x: number, lo: number, hi: number): boolean {
  return x < lo || x > hi;
}

console.log(isInRange(5, 1, 10));
console.log(isInRange(15, 1, 10));
console.log(isOutOfRange(5, 1, 10));
console.log(isOutOfRange(15, 1, 10));
