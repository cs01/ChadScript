// @test expectTestPassed
// Regression for dapweb NOTES #17: `import * as ns` + `ns.fn()` dispatch
// was rejected with "Method 'fn' on 'ns' is not supported." Namespace
// imports from relative modules should lower to direct calls — the
// imported functions are already merged into the flat AST.
import * as lib from "./ns-import-dispatch-lib.js";

const s = lib.greet();
const n = lib.double(21);
if (s === "hello" && n === 42) {
  console.log("TEST_PASSED");
}
