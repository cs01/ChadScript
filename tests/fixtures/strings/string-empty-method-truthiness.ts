// @test-description: empty string from method calls is falsy
function main(): void {
  let passed = true;

  const str = "  ";
  if (str.trim()) {
    passed = false;
  }

  const nonEmpty = "hello";
  if (!nonEmpty.trim()) {
    passed = false;
  }

  const upper = "HELLO";
  if (!upper.toLowerCase()) {
    passed = false;
  }

  const empty = "";
  if (empty.trim()) {
    passed = false;
  }

  if (passed) {
    console.log("TEST_PASSED");
  } else {
    console.log("FAIL");
  }
}

main();
