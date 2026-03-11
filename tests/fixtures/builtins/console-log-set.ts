// @test-description: console.log prints set contents
function test() {
  const s = new Set<number>();
  s.add(10);
  s.add(20);
  s.add(30);
  console.log(s);

  console.log("TEST_PASSED");
}
test();
