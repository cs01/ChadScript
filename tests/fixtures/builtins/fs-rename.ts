function testFsRename(): void {
  const testFile = "/tmp/chad_rename_test_src.txt";
  const destFile = "/tmp/chad_rename_test_dst.txt";

  fs.writeFileSync(testFile, "rename me");

  if (!fs.existsSync(testFile)) {
    console.log("FAIL: source file not created");
    process.exit(1);
  }

  fs.renameSync(testFile, destFile);

  if (fs.existsSync(testFile)) {
    console.log("FAIL: source should not exist after rename");
    process.exit(1);
  }

  if (!fs.existsSync(destFile)) {
    console.log("FAIL: dest should exist after rename");
    process.exit(1);
  }

  const content = fs.readFileSync(destFile);
  if (content !== "rename me") {
    console.log("FAIL: content mismatch after rename");
    process.exit(1);
  }

  fs.unlinkSync(destFile);
  console.log("TEST_PASSED");
}
testFsRename();
