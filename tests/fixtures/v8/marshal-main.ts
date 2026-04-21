// @test-description: cross-boundary marshal — native imports pragma-file export
// @test-skip

import { ms } from "./marshal-ms";

const r: string = ms("2 days");
if (r === "172800000") {
  console.log("TEST_PASSED");
} else {
  console.log("FAIL: " + r);
}
