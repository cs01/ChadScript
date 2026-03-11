// @test-description: json stringify map produces correct json
function test() {
  const m = new Map<string, string>();
  m.set("hello", "world");
  const result = JSON.stringify(m);
  if (result === '{"hello":"world"}') {
    console.log("TEST_PASSED");
  }
}
test();
