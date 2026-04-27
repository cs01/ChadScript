function firstElement<T>(arr: Array<T>): T {
  return arr[0];
}

const nums: Array<number> = [10, 20, 30];
const strs: Array<string> = ["a", "b", "c"];

console.log(firstElement<number>(nums));
console.log(firstElement<string>(strs));
