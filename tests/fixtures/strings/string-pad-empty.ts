function testPadEmpty(): void {
  const s: string = "hello";

  const r1: string = s.padStart(10, " ");
  if (r1 !== "     hello") {
    console.log("FAIL: padStart with space got '" + r1 + "'");
    process.exit(1);
  }

  const r2: string = s.padEnd(10, " ");
  if (r2 !== "hello     ") {
    console.log("FAIL: padEnd with space got '" + r2 + "'");
    process.exit(1);
  }

  const r3: string = s.padStart(10, "");
  if (r3 !== "hello") {
    console.log("FAIL: padStart with empty string got '" + r3 + "'");
    process.exit(1);
  }

  const r4: string = s.padEnd(10, "");
  if (r4 !== "hello") {
    console.log("FAIL: padEnd with empty string got '" + r4 + "'");
    process.exit(1);
  }

  const r5: string = s.padStart(3, "x");
  if (r5 !== "hello") {
    console.log("FAIL: padStart shorter than string got '" + r5 + "'");
    process.exit(1);
  }

  console.log("TEST_PASSED");
}

testPadEmpty();
