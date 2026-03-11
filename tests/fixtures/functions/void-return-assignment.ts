function doNothing(): void {
  return;
}

function test(): void {
  const x = doNothing();
  console.log("TEST_PASSED");
}
test();
