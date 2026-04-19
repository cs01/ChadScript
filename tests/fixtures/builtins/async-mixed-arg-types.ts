// @test expectTestPassed
// Regression: async functions with mixed-type parameters (string + number,
// string + object, etc.) emitted IR that typed every arg as `double`
// because the param-type-resolution branch in function-generator.ts and
// calls.ts was `else if` of the async branch — async funcs skipped param
// resolution entirely. A string arg ended up passed as i64, crashing
// downstream strlen/puts.
async function send(id: string, seq: number, body: string): Promise<string> {
  return id + "|" + seq + "|" + body;
}

async function main(): Promise<void> {
  const r = await send("req-1", 42, "hello");
  if (r === "req-1|42|hello") console.log("TEST_PASSED");
  else console.log("FAIL: " + r);
}
main();
runEventLoop();
