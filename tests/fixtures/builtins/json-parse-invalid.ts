// @test-exit-code: 1
const nums: number[] = JSON.parse<number[]>("not valid json");
console.log(nums.length);
