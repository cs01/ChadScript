function testCrypto(): void {
  const sha256 = crypto.sha256("hello");
  if (sha256 !== "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824") {
    console.log("FAIL: sha256 mismatch");
    console.log(sha256);
    process.exit(1);
  }

  const md5 = crypto.md5("hello");
  if (md5 !== "5d41402abc4b2a76b9719d911017c592") {
    console.log("FAIL: md5 mismatch");
    console.log(md5);
    process.exit(1);
  }

  const sha512 = crypto.sha512("hello");
  if (sha512 !== "9b71d224bd62f3785d96d46ad3ea3d73319bfbc2890caadae2dff72519673ca72323c3d99ba5c11d7c7acc6e14b8c5da0c4663475c2e5c3adef46f73bcdec043") {
    console.log("FAIL: sha512 mismatch");
    console.log(sha512);
    process.exit(1);
  }

  const rand = crypto.randomBytes(16);
  if (rand.length !== 32) {
    console.log("FAIL: randomBytes length should be 32 hex chars");
    process.exit(1);
  }

  const rand2 = crypto.randomBytes(16);
  if (rand === rand2) {
    console.log("FAIL: two randomBytes calls should differ");
    process.exit(1);
  }

  console.log("TEST_PASSED");
}
testCrypto();
