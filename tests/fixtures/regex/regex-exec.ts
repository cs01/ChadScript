function testRegexExec(): void {
  const result = /([0-9]+)-([a-z]+)/.exec("abc-123-hello-world");
  if (result === null) {
    console.log("FAIL: exec should return a match");
    process.exit(1);
  }
  if (result[0] !== "123-hello") {
    console.log("FAIL: full match should be 123-hello");
    process.exit(1);
  }
  if (result[1] !== "123") {
    console.log("FAIL: group 1 should be 123");
    process.exit(1);
  }
  if (result[2] !== "hello") {
    console.log("FAIL: group 2 should be hello");
    process.exit(1);
  }

  const noMatch = /xyz/.exec("hello world");
  if (noMatch !== null) {
    console.log("FAIL: exec should return null for no match");
    process.exit(1);
  }

  const pattern = /([a-z]+)@([a-z]+)/;
  const emailResult = pattern.exec("user@host.com");
  if (emailResult === null) {
    console.log("FAIL: variable regex exec should match");
    process.exit(1);
  }
  if (emailResult[1] !== "user") {
    console.log("FAIL: email user should be user");
    process.exit(1);
  }

  const re = new RegExp("([0-9]+)\\.([0-9]+)");
  const verResult = re.exec("version 3.14 release");
  if (verResult === null) {
    console.log("FAIL: new RegExp exec should match");
    process.exit(1);
  }
  if (verResult[1] !== "3") {
    console.log("FAIL: major version should be 3");
    process.exit(1);
  }
  if (verResult[2] !== "14") {
    console.log("FAIL: minor version should be 14");
    process.exit(1);
  }

  console.log("TEST_PASSED");
}
testRegexExec();
