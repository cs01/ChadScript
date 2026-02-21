function testPathIsAbsolute(): void {
  if (!path.isAbsolute("/home/user")) {
    console.log("FAIL: /home/user should be absolute");
    process.exit(1);
  }
  if (!path.isAbsolute("/")) {
    console.log("FAIL: / should be absolute");
    process.exit(1);
  }
  if (path.isAbsolute("relative/path")) {
    console.log("FAIL: relative/path should not be absolute");
    process.exit(1);
  }
  if (path.isAbsolute("file.txt")) {
    console.log("FAIL: file.txt should not be absolute");
    process.exit(1);
  }
  console.log("TEST_PASSED");
}
testPathIsAbsolute();
