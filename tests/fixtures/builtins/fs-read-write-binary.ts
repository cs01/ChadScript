// Test binary file I/O with Uint8Array — write then read back
const testFile = "/tmp/chadscript-binary-io-test.bin";

// Create a Uint8Array with known bytes including high values
const data = new Uint8Array(8);
data[0] = 137;
data[1] = 80;
data[2] = 78;
data[3] = 71;
data[4] = 0;
data[5] = 255;
data[6] = 128;
data[7] = 1;

// Write binary data
fs.writeFileSync(testFile, data);

// Read it back as Uint8Array
const result: Uint8Array = fs.readFileSync(testFile);

if (result.length !== 8) {
  console.log("FAIL: expected length 8, got " + result.length.toString());
  process.exit(1);
}

if (result[0] !== 137) {
  console.log("FAIL: byte 0 should be 137");
  process.exit(2);
}

if (result[4] !== 0) {
  console.log("FAIL: byte 4 should be 0");
  process.exit(3);
}

if (result[5] !== 255) {
  console.log("FAIL: byte 5 should be 255");
  process.exit(4);
}

if (result[7] !== 1) {
  console.log("FAIL: byte 7 should be 1");
  process.exit(5);
}

// Clean up
fs.unlinkSync(testFile);

console.log("TEST_PASSED");
