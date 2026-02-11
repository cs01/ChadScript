function testStdoutWrite(): void {
  process.stdout.write("hello");
  process.stdout.write(" world");
  process.stdout.write("\n");

  console.log("TEST_PASSED");
}
testStdoutWrite();
