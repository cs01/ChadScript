const nums = [10, 20, 30];
const collected: number[] = [];
nums.forEach((x: number): void => {
  collected.push(x + 1);
});
console.log(collected.join(","));
