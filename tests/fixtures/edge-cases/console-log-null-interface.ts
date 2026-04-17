// @test-description: console.log on null interface value prints null instead of segfaulting
interface Item {
  name: string;
}
function f(): Item | null {
  return null;
}
const y = f();
console.log(y);
console.log("TEST_PASSED");
