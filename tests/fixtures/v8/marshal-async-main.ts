// @test-description: marshal async — native awaits pragma-side setTimeout
// @test-skip

import { delayedHi } from "./marshal-async-pragma";

async function main(): Promise<void> {
  const r: string = await delayedHi("chad");
  if (r === "hi chad") {
    console.log("TEST_PASSED");
  } else {
    console.log("FAIL: " + r);
  }
}

main();
