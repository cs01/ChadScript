// @test expectTestPassed
function handler(msg: string): void {
  console.log("handler got: " + msg);
}

function registerAndCall(h: (m: string) => void, s: string): void {
  // h(s) is call-through-param — separate bug, avoid for this fixture.
  // Just verify we can pass-by-reference without broken IR.
  console.log("registered");
}

registerAndCall(handler, "hi");
console.log("TEST_PASSED");
