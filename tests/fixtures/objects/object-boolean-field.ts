function test(): void {
  const obj = { name: "test", active: true, done: false };
  if (obj.active !== true) {
    console.log("FAIL active should be true");
    return;
  }
  if (obj.done !== false) {
    console.log("FAIL done should be false");
    return;
  }
  console.log("TEST_PASSED");
}
test();
