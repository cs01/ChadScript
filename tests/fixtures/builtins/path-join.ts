import path from "path";

function testPathJoin(): void {
  const result = path.join("/usr", "local", "bin");
  if (result !== "/usr/local/bin") {
    console.log("FAIL: join got " + result);
    process.exit(1);
  }

  const result2 = path.join("foo", "bar", "baz");
  if (result2 !== "foo/bar/baz") {
    console.log("FAIL: relative join got " + result2);
    process.exit(1);
  }

  console.log("TEST_PASSED");
}
testPathJoin();
