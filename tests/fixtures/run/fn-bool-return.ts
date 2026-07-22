function inRange(x: number, lo: number, hi: number): boolean {
  if (x < lo) {
    return false;
  }
  if (x > hi) {
    return false;
  }
  return true;
}
console.log(inRange(5, 1, 10), inRange(0, 1, 10), inRange(11, 1, 10));
