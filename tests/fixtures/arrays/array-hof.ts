const nums: number[] = [1, 2, 3, 4, 5];

const doubled: number[] = nums.map((x: number): number => x * 2);
console.log(doubled[0]);
console.log(doubled[1]);
console.log(doubled[4]);

const evens: number[] = nums.filter((x: number): boolean => x % 2 === 0);
console.log(evens.length);
console.log(evens[0]);
console.log(evens[1]);

let sum: number = 0;
nums.forEach((x: number): void => {
  sum = sum + x;
});
console.log(sum);
