const double = (x: number): number => x * 2;
function named(): number {
  return 1;
}
console.log(double);
console.log(named, [double]);
const fs: ((x: number) => number)[] = [double];
console.log(fs);
