const factor = 3;
const nums = [1, 2, 3, 4];
const out = nums.map((x: number): number => x * factor).filter((x: number): boolean => x > 5);
console.log(out.join(","));
