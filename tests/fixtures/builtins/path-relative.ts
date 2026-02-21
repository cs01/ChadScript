function testPathRelative(): void {
  let r1 = path.relative("/foo/bar", "/foo/baz");
  if (r1 !== "../baz") {
    console.log("FAIL: sibling: " + r1);
    process.exit(1);
  }

  let r2 = path.relative("/foo/bar/baz", "/foo/qux");
  if (r2 !== "../../qux") {
    console.log("FAIL: two levels up: " + r2);
    process.exit(1);
  }

  let r3 = path.relative("/foo/bar", "/foo/bar");
  if (r3 !== ".") {
    console.log("FAIL: same path: " + r3);
    process.exit(1);
  }

  let r4 = path.relative("/foo/bar", "/foo/bar/baz/qux");
  if (r4 !== "baz/qux") {
    console.log("FAIL: child: " + r4);
    process.exit(1);
  }

  let r5 = path.relative("/a/b/c", "/x/y/z");
  if (r5 !== "../../../x/y/z") {
    console.log("FAIL: disjoint: " + r5);
    process.exit(1);
  }

  console.log("TEST_PASSED");
}
testPathRelative();
