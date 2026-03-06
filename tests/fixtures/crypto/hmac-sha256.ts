function testHmac(): void {
  const key = "key";
  const data = "The quick brown fox jumps over the lazy dog";
  const expected = "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8";
  const result = crypto.hmacSha256(key, data);
  if (result === expected) {
    console.log("TEST_PASSED");
  } else {
    console.log("FAILED: got " + result);
  }
}
testHmac();
