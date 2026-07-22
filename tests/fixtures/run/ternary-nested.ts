function sign(n: number): string {
  return n > 0 ? "pos" : n < 0 ? "neg" : "zero";
}
console.log(sign(-3));
console.log(sign(0));
console.log(sign(7));
const nums = [1, 2, 3, 4];
const labels = nums.map((x: number): string => (x % 2 === 0 ? "even" : "odd"));
console.log(labels.join(","));
