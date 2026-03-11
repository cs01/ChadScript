function testStringConcatNumber(): void {
  const n: number = 42;
  const s: string = "The answer is " + n;
  if (s !== "The answer is 42") {
    console.log("FAIL: got '" + s + "'");
    process.exit(1);
  }

  const pi: number = 3.14;
  const s2: string = "Pi is " + pi;
  if (s2.indexOf("Pi is 3.14") !== 0) {
    console.log("FAIL: pi concat got '" + s2 + "'");
    process.exit(1);
  }

  const zero: number = 0;
  const s3: string = "zero:" + zero;
  if (s3 !== "zero:0") {
    console.log("FAIL: zero concat got '" + s3 + "'");
    process.exit(1);
  }

  console.log("TEST_PASSED");
}

testStringConcatNumber();
