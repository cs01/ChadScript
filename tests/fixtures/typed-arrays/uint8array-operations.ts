function testUint8Array(): void {
  const buf = new Uint8Array(4);
  buf[0] = 65;
  buf[1] = 66;
  buf[2] = 67;
  buf[3] = 0;

  if (buf[0] !== 65) {
    console.log("FAIL: buf[0] should be 65, got " + buf[0]);
    process.exit(1);
  }

  if (buf.length !== 4) {
    console.log("FAIL: length should be 4, got " + buf.length);
    process.exit(1);
  }

  if (buf[2] !== 67) {
    console.log("FAIL: buf[2] should be 67, got " + buf[2]);
    process.exit(1);
  }

  console.log("TEST_PASSED");
}

testUint8Array();
