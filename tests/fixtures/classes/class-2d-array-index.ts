// @test-skip
// passes with node compiler but native compiler fails on 2d object-array indexing
class Foo {
  value: number;
  constructor(v: number) {
    this.value = v;
  }
}

const grid: Foo[][] = [[new Foo(1), new Foo(2)], [new Foo(3)]];
const row = grid[0];
const item = row[0];

if (item.value === 1) {
  console.log("TEST_PASSED");
} else {
  console.log("FAIL: value = " + item.value.toString());
}
