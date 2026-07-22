function hypot(a: number, b: number): number {
  return Math.sqrt(a * a + b * b);
}
console.log(hypot(3, 4));
let sum = 0;
for (let i = 1; i <= 10; i++) {
  sum += Math.sqrt(i);
}
console.log(sum);
