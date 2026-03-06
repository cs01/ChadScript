function testBtoaAtob(): void {
  const encoded = btoa("Hello, World!");
  const expected = "SGVsbG8sIFdvcmxkIQ==";
  if (encoded !== expected) {
    console.log("FAILED btoa: got " + encoded);
    process.exit(1);
  }

  const decoded = atob(encoded);
  if (decoded !== "Hello, World!") {
    console.log("FAILED atob: got " + decoded);
    process.exit(1);
  }

  const roundtrip = atob(btoa("ChadScript"));
  if (roundtrip !== "ChadScript") {
    console.log("FAILED roundtrip: got " + roundtrip);
    process.exit(1);
  }

  console.log("TEST_PASSED");
}
testBtoaAtob();
