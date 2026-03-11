// @test-description: console.log prints booleans and comparisons correctly

function getTrue(): boolean {
  return true;
}

function getFalse(): boolean {
  return false;
}

console.log(true);
console.log(false);

const b = getTrue();
console.log(b);
const b2 = getFalse();
console.log(b2);

console.log(1 === 1);
console.log(1 === 2);
console.log(5 > 3);
console.log(!false);

console.log("mixed", true, 42, "end");

console.log("TEST_PASSED");
