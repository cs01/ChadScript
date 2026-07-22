const nums = [1, 2, 3, 4, 5];
console.log(nums.reduce((acc: number, x: number): number => acc + x, 0));
console.log(nums.reduce((acc: number, x: number): number => acc * x));
const words = ["a", "bb", "ccc"];
console.log(words.reduce((acc: number, w: string): number => acc + w.length, 0));
