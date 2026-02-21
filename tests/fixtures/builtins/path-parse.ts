function testPathParse(): void {
  let p1 = path.parse("/home/user/file.txt");
  if (p1.root !== "/") {
    console.log("FAIL: root: " + p1.root);
    process.exit(1);
  }
  if (p1.dir !== "/home/user") {
    console.log("FAIL: dir: " + p1.dir);
    process.exit(1);
  }
  if (p1.base !== "file.txt") {
    console.log("FAIL: base: " + p1.base);
    process.exit(1);
  }
  if (p1.name !== "file") {
    console.log("FAIL: name: " + p1.name);
    process.exit(1);
  }
  if (p1.ext !== ".txt") {
    console.log("FAIL: ext: " + p1.ext);
    process.exit(1);
  }

  let p2 = path.parse("file.js");
  if (p2.root !== "") {
    console.log("FAIL: no-dir root: " + p2.root);
    process.exit(1);
  }
  if (p2.dir !== "") {
    console.log("FAIL: no-dir dir: " + p2.dir);
    process.exit(1);
  }
  if (p2.base !== "file.js") {
    console.log("FAIL: no-dir base: " + p2.base);
    process.exit(1);
  }
  if (p2.name !== "file") {
    console.log("FAIL: no-dir name: " + p2.name);
    process.exit(1);
  }
  if (p2.ext !== ".js") {
    console.log("FAIL: no-dir ext: " + p2.ext);
    process.exit(1);
  }

  let p3 = path.parse("/root/noext");
  if (p3.ext !== "") {
    console.log("FAIL: noext ext: " + p3.ext);
    process.exit(1);
  }
  if (p3.name !== "noext") {
    console.log("FAIL: noext name: " + p3.name);
    process.exit(1);
  }

  console.log("TEST_PASSED");
}
testPathParse();
