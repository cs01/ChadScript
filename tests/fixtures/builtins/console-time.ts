function testConsoleTime(): void {
  console.time("test");

  let sum = 0;
  for (let i = 0; i < 1000; i++) {
    sum = sum + i;
  }

  console.timeEnd("test");

  if (sum !== 499500) {
    console.log("FAIL: wrong sum");
    process.exit(1);
  }

  console.log("TEST_PASSED");
}
testConsoleTime();
