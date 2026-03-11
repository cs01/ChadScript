// @test-description: console.log prints map contents
function test() {
  const m = new Map<string, string>();
  m.set("a", "1");
  m.set("b", "2");
  console.log(m);

  const empty = new Map<string, string>();
  console.log(empty);

  console.log("TEST_PASSED");
}
test();
