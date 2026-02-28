// @test-description: dynamic regex exec returns string array

function testExecDyn(): void {
  const re = new RegExp("([a-z]+)/([0-9]+)");
  const m1 = re.execDyn("rooms/42");
  if (m1 === null) {
    console.log("FAIL: expected match");
    process.exit(1);
  }
  if (m1[0] !== "rooms/42") {
    console.log("FAIL: full match wrong");
    process.exit(1);
  }
  if (m1[1] !== "rooms") {
    console.log("FAIL: group 1 wrong");
    process.exit(1);
  }
  if (m1[2] !== "42") {
    console.log("FAIL: group 2 wrong");
    process.exit(1);
  }

  const m2 = re.execDyn("nope");
  if (m2 !== null) {
    console.log("FAIL: expected no match");
    process.exit(1);
  }

  console.log("TEST_PASSED");
}
testExecDyn();
