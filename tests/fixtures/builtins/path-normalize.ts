function testPathNormalize(): void {
  let result1 = path.normalize("/foo/bar//baz");
  if (result1 !== "/foo/bar/baz") {
    console.log("FAIL: double slash: " + result1);
    process.exit(1);
  }

  let result2 = path.normalize("/foo/./bar");
  if (result2 !== "/foo/bar") {
    console.log("FAIL: dot component: " + result2);
    process.exit(1);
  }

  let result3 = path.normalize("/foo/bar/../baz");
  if (result3 !== "/foo/baz") {
    console.log("FAIL: dotdot component: " + result3);
    process.exit(1);
  }

  let sep = path.sep;
  if (sep !== "/") {
    console.log("FAIL: path.sep");
    process.exit(1);
  }

  console.log("TEST_PASSED");
}
testPathNormalize();
