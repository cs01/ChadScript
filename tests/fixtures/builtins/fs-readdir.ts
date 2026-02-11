function testReaddirSync(): void {
  const files = fs.readdirSync("/tmp");
  if (files.length < 1) {
    console.log("FAIL: /tmp should have files");
    process.exit(1);
  }

  const selfFiles = fs.readdirSync("tests/fixtures/builtins");
  let found = false;
  for (let i = 0; i < selfFiles.length; i = i + 1) {
    if (selfFiles[i] === "tty-isatty.ts") {
      found = true;
    }
  }
  if (!found) {
    console.log("FAIL: should find tty-isatty.ts in fixtures/builtins");
    process.exit(1);
  }

  const badDir = fs.readdirSync("/nonexistent_dir_12345");
  if (badDir.length !== 0) {
    console.log("FAIL: nonexistent dir should return empty array");
    process.exit(1);
  }

  console.log("TEST_PASSED");
}
testReaddirSync();
