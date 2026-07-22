const nums = [3, 8, 12, 5, 20];
console.log(nums.some((x: number): boolean => x > 15));
console.log(nums.some((x: number): boolean => x > 50));
console.log(nums.every((x: number): boolean => x > 0));
console.log(nums.every((x: number): boolean => x > 5));
const threshold = 10;
console.log(
  nums.filter((x: number): boolean => x > threshold).some((x: number): boolean => x === 12),
);
