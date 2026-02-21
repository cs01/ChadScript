function testPathExtname(): void {
  const ext1 = path.extname("file.ts");
  if (ext1 !== ".ts") {
    console.log("FAIL: extname('file.ts') =", ext1);
    process.exit(1);
  }

  const ext2 = path.extname("/home/user/readme.md");
  if (ext2 !== ".md") {
    console.log("FAIL: extname path with dirs");
    process.exit(1);
  }

  const ext3 = path.extname("noext");
  if (ext3 !== "") {
    console.log("FAIL: extname no extension");
    process.exit(1);
  }

  const ext4 = path.extname("archive.tar.gz");
  if (ext4 !== ".gz") {
    console.log("FAIL: extname double extension");
    process.exit(1);
  }

  console.log("TEST_PASSED");
}
testPathExtname();
