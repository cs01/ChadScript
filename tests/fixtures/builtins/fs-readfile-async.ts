async function testReadFileAsync(): Promise<void> {
  const testFile = "/tmp/chad_test_readfile_async.txt";
  fs.writeFileSync(testFile, "async read works");

  let content = await fs.readFile(testFile);
  if (content !== "async read works") {
    console.log("FAIL: readFile content mismatch");
    process.exit(1);
  }

  fs.unlinkSync(testFile);
  console.log("TEST_PASSED");
}
testReadFileAsync();
