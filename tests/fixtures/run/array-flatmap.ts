const nums = [1, 2, 3];
console.log(nums.flatMap((x: number): number[] => [x, x * 10]).join(","));
const words = ["ab", "cd"];
console.log(words.flatMap((w: string): string[] => [w, w + "!"]).join(","));
console.log(nums.flatMap((x: number): number[] => (x % 2 === 1 ? [x] : [])).join(","));
const factor = 100;
console.log(nums.flatMap((x: number): number[] => [x, x * factor]).join(","));
