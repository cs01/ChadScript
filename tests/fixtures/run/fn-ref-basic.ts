function inc(x: number): number {
  return x + 1;
}
function shout(s: string): string {
  return s.toUpperCase();
}
function logIt(): void {
  console.log("side effect");
}

const nums = [1, 2, 3];
console.log(nums.map(inc).join(","));
const f = inc;
console.log(f(41));
const g: (s: string) => string = shout;
console.log(g("hi"));
setTimeout(logIt, 1);
console.log(nums.filter((n) => inc(n) > 2).length);
