function testFsCopyFile(): void {
  const srcFile = "/tmp/chad_copy_test_src.txt";
  const destFile = "/tmp/chad_copy_test_dst.txt";

  fs.writeFileSync(srcFile, "copy this content");

  fs.copyFileSync(srcFile, destFile);

  if (!fs.existsSync(destFile)) {
    console.log("FAIL: dest should exist after copy");
    process.exit(1);
  }

  const srcContent = fs.readFileSync(srcFile);
  const destContent = fs.readFileSync(destFile);

  if (srcContent !== destContent) {
    console.log("FAIL: content mismatch after copy");
    process.exit(1);
  }

  if (destContent !== "copy this content") {
    console.log("FAIL: wrong content");
    process.exit(1);
  }

  fs.unlinkSync(srcFile);
  fs.unlinkSync(destFile);
  console.log("TEST_PASSED");
}
testFsCopyFile();
