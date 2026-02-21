async function testWriteFileAsync(): Promise<void> {
  const testFile = "/tmp/chad_test_writefile_async.txt";

  await fs.writeFile(testFile, "async write works");

  let content = fs.readFileSync(testFile);
  if (content !== "async write works") {
    console.log("FAIL: writeFile content mismatch");
    process.exit(1);
  }

  fs.unlinkSync(testFile);
  console.log("TEST_PASSED");
}
testWriteFileAsync();
