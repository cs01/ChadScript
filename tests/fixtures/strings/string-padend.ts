function testPadEnd(): void {
  let str = "hello";
  let result = str.padEnd(10, ".");

  if (result !== "hello.....") {
    console.log("FAIL: padEnd with fill char");
    process.exit(1);
  }

  let result2 = str.padEnd(10);
  if (result2 !== "hello     ") {
    console.log("FAIL: padEnd with default space");
    process.exit(1);
  }

  let result3 = str.padEnd(3, ".");
  if (result3 !== "hello") {
    console.log("FAIL: padEnd shorter than string");
    process.exit(1);
  }

  console.log("TEST_PASSED");
}
testPadEnd();
