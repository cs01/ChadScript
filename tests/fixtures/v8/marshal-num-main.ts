// @test-description: marshal number-return across boundary
// @test-skip

import { parseMs } from "./marshal-num-pragma";

const n: number = parseMs("3s");
if (n === 3000) {
  console.log("TEST_PASSED");
} else {
  console.log("FAIL: " + n.toString());
}
