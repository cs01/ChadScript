// @test-exit-code: 0
// Test function expressions in array methods
function testMap() {
  const arr = [1, 2, 3, 4, 5];

  // Test with inline function expression
  const doubled = arr.map(function (x) {
    return x * 2;
  });

  console.log(doubled[0]);
  console.log(doubled[1]);
  console.log(doubled[2]);
  console.log(doubled[3]);
  console.log(doubled[4]);

  return 0;
}

process.exit(testMap());
