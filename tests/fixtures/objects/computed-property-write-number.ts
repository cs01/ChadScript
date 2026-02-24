// @test-description: computed property write with numeric value
const obj = { x: 10, y: 20 };
const key = "x";
obj[key] = 42;
if (obj.x === 42 && obj.y === 20) {
  console.log("TEST_PASSED");
}
