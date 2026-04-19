// @test expectTestPassed
// Regression for dapweb #2: module-level `let x = namedFn` where namedFn is
// a top-level function declared anywhere in the file. Previously errored
// "Reference to undeclared variable 'namedFn'" because the symbol table
// was populated in source order, missing forward function declarations.
// Also exercises calling through the resulting function-pointer variable.
function defaultOnEvent(msg: string): void {
  if (msg === "hello") console.log("TEST_PASSED");
}
let onEvent: (msg: string) => void = defaultOnEvent;
onEvent("hello");
