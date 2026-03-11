function testArrayFrom(): void {
  const arr: string[] = ["hello", "world", "test"];
  const copy: string[] = Array.from(arr);

  if (copy.length !== 3) {
    console.log("FAIL: copy length should be 3, got " + copy.length);
    process.exit(1);
  }

  if (copy[0] !== "hello") {
    console.log("FAIL: copy[0] should be hello, got " + copy[0]);
    process.exit(1);
  }

  if (copy[2] !== "test") {
    console.log("FAIL: copy[2] should be test, got " + copy[2]);
    process.exit(1);
  }

  console.log("TEST_PASSED");
}

testArrayFrom();
