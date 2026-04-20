// @test-description: issue #591 — NULL char* from FFI round-trips to TS as empty string
declare function getenv(name: string): string;

const v = getenv("__CHADSCRIPT_TEST_VAR_THAT_DOES_NOT_EXIST_91237__");
if (v === "") {
  console.log("TEST_PASSED");
} else {
  console.log("FAIL: got " + v);
}
