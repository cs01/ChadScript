function testEncodeUri(): void {
  const encoded = encodeURIComponent("hello world & foo=bar");
  const expected = "hello%20world%20%26%20foo%3Dbar";
  if (encoded !== expected) {
    console.log("FAILED encode: got " + encoded);
    process.exit(1);
  }

  const decoded = decodeURIComponent(encoded);
  if (decoded !== "hello world & foo=bar") {
    console.log("FAILED decode: got " + decoded);
    process.exit(1);
  }

  const unreserved = encodeURIComponent("abc-_.~123");
  if (unreserved !== "abc-_.~123") {
    console.log("FAILED unreserved: got " + unreserved);
    process.exit(1);
  }

  console.log("TEST_PASSED");
}
testEncodeUri();
