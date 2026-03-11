// @test-description: console.log prints booleans, null, undefined correctly

function getTrue(): boolean {
  return true;
}

function getFalse(): boolean {
  return false;
}

console.log(true);
console.log(false);
console.log(null);
console.log(undefined);

const b = getTrue();
console.log(b);
const b2 = getFalse();
console.log(b2);

console.log("mixed", true, 42, null, "end");

console.log("TEST_PASSED");
