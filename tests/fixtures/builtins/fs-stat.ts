function testStatSync(): void {
  const stats = fs.statSync("tests/fixtures/builtins/fs-stat.ts");
  if (stats.size < 1) {
    console.log("FAIL: file size should be > 0");
    process.exit(1);
  }
  if (!stats.isFile()) {
    console.log("FAIL: should be a file");
    process.exit(1);
  }
  if (stats.isDirectory()) {
    console.log("FAIL: should not be a directory");
    process.exit(1);
  }

  const dirStats = fs.statSync("tests/fixtures/builtins");
  if (!dirStats.isDirectory()) {
    console.log("FAIL: should be a directory");
    process.exit(1);
  }
  if (dirStats.isFile()) {
    console.log("FAIL: directory should not be a file");
    process.exit(1);
  }

  console.log("TEST_PASSED");
}
testStatSync();
