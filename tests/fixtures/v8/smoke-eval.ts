// @test-description: v8 phase 0 smoke — eval JS from native and round-trip a number
// @test-skip

declare function cs_v8_eval_number(src: string): number;

const result = cs_v8_eval_number("1 + 2 * 3");
if (result === 7) {
  console.log("TEST_PASSED");
} else {
  console.log("TEST_FAILED: expected 7, got " + result.toString());
}
