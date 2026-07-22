const nums = [3, 8, 12, 5, 20];
console.log(nums.find((x: number): boolean => x > 10) ?? -1);
console.log(nums.find((x: number): boolean => x > 100) ?? -1);
console.log(nums.findIndex((x: number): boolean => x === 5));
console.log(nums.findIndex((x: number): boolean => x === 999));
const words = ["hi", "hello", "hey"];
console.log(words.find((w: string): boolean => w.length === 5) ?? "none");
