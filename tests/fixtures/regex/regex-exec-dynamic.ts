// @test-description: regex exec on runtime-constructed pattern returns correct groups

function testExecDynamic(): void {
  const re = new RegExp("([a-z]+)/([0-9]+)");
  const m1 = re.exec("rooms/42");
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

  const m2 = re.exec("nope");
  if (m2 !== null) {
    console.log("FAIL: expected no match");
    process.exit(1);
  }

  console.log("TEST_PASSED");
}
testExecDynamic();
