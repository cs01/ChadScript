function sum(...nums: number[]): number {
  let total = 0;
  for (const n of nums) {
    total += n;
  }
  return total;
}
console.log(sum(1, 2, 3));
console.log(sum());
console.log(sum(10));
const arr = [4, 5, 6];
console.log(sum(...arr));
console.log(sum(1, ...arr, 100));
function label(prefix: string, ...items: string[]): string {
  return prefix + ": " + items.join(", ");
}
console.log(label("fruits", "apple", "banana"));
console.log(label("empty"));
const words = ["x", "y"];
console.log(label("letters", ...words, "z"));
