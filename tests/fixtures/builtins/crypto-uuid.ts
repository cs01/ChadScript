function testCryptoRandomUUID(): void {
  const uuid1 = crypto.randomUUID();
  const uuid2 = crypto.randomUUID();

  if (uuid1.length !== 36) {
    console.log("FAIL: UUID length should be 36, got", uuid1.length);
    process.exit(1);
  }

  if (uuid1.charAt(8) !== "-") {
    console.log("FAIL: missing dash at position 8");
    process.exit(1);
  }

  if (uuid1.charAt(13) !== "-") {
    console.log("FAIL: missing dash at position 13");
    process.exit(1);
  }

  if (uuid1.charAt(18) !== "-") {
    console.log("FAIL: missing dash at position 18");
    process.exit(1);
  }

  if (uuid1.charAt(23) !== "-") {
    console.log("FAIL: missing dash at position 23");
    process.exit(1);
  }

  if (uuid1 === uuid2) {
    console.log("FAIL: two UUIDs should not be identical");
    process.exit(1);
  }

  console.log("TEST_PASSED");
}
testCryptoRandomUUID();
