// @test-description: v8 phase 0 smoke — primitives + tagged error path
// @test-skip

declare function cs_v8_eval_number(src: string): number;
declare function cs_v8_eval_string(src: string): string;
declare function cs_v8_last_error(): string;
declare function cs_v8_clear_error(): void;

function fail(msg: string): void {
  console.log("TEST_FAILED: " + msg);
}

const happy = cs_v8_eval_number("1 + 2 * 3");
if (happy !== 7) {
  fail("expected 7, got " + happy.toString());
} else if (cs_v8_last_error().length !== 0) {
  fail("unexpected error after happy path: " + cs_v8_last_error());
} else {
  const thrown = cs_v8_eval_number("throw new Error('oops from ts')");
  const err = cs_v8_last_error();
  if (err.indexOf("oops from ts") < 0) {
    fail("expected error to contain 'oops from ts', got: " + err);
  } else {
    cs_v8_clear_error();
    const recovered = cs_v8_eval_number("100 + 1");
    if (recovered !== 101) {
      fail("recovery failed, got " + recovered.toString());
    } else if (cs_v8_last_error().length !== 0) {
      fail("error not cleared after recovery: " + cs_v8_last_error());
    } else {
      console.log("TEST_PASSED");
    }
  }
}
