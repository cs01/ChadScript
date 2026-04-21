// @test-description: FFI `declare function f(): string | null` round-trips C NULL to js null
declare function getenv(name: string): string | null;

// HOME is virtually always set on POSIX; use a nonsense name for the null case.
const home = getenv("HOME");
const missing = getenv("THIS_VAR_DEFINITELY_DOES_NOT_EXIST_ZZZZ");

let ok = true;
if (home === null) ok = false;
if (missing !== null) ok = false;

if (ok && home !== null && home.length > 0) {
  console.log("TEST_PASSED");
}
