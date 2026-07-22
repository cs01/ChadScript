function inRange(x: number, lo: number, hi: number): boolean {
  return x >= lo && x <= hi;
}
console.log(inRange(5, 1, 10), inRange(0, 1, 10), inRange(11, 1, 10));
