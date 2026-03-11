function testStringSlice(): void {
  const s: string = "hello world";

  const sub1: string = s.slice(0, 5);
  if (sub1 !== "hello") {
    console.log("FAIL: slice(0,5) should be 'hello', got '" + sub1 + "'");
    process.exit(1);
  }

  const sub2: string = s.slice(6);
  if (sub2 !== "world") {
    console.log("FAIL: slice(6) should be 'world', got '" + sub2 + "'");
    process.exit(1);
  }

  const sub3: string = s.slice(0, 0);
  if (sub3 !== "") {
    console.log("FAIL: slice(0,0) should be empty, got '" + sub3 + "'");
    process.exit(1);
  }

  console.log("TEST_PASSED");
}

testStringSlice();
