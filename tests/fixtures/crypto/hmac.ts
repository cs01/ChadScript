// @test-description: crypto.hmacSha256 produces correct hex output

const result = crypto.hmacSha256("secret", "hello");
if (result.length !== 64) {
  console.log("FAIL: expected 64 hex chars, got " + result.length);
  process.exit(1);
}

const result2 = crypto.hmacSha256("key", "The quick brown fox jumps over the lazy dog");
if (result2 !== "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8") {
  console.log("FAIL: expected known HMAC value, got " + result2);
  process.exit(1);
}

console.log("TEST_PASSED");
