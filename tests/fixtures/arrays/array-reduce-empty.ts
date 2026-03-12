// @test-exit-code: 1
function add(acc: number, x: number): number {
  return acc + x;
}

const empty: number[] = [];
const result = empty.reduce(add);
console.log("should not reach here: " + result);
