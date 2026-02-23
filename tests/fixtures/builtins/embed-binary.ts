// Test binary file embedding — verifies high-byte values survive the embed pipeline
// The binary data file has 20 bytes with values 0x80-0xFF (Latin-1 range)
ChadScript.embedDir("./embed-binary-data");

const data = ChadScript.getEmbeddedFileAsUint8Array("test.bin");

// Length must be 20
if (data.length !== 20) {
  console.log("FAIL: expected length 20, got " + data.length.toString());
  process.exit(1);
}

// Check PNG magic bytes: 0x89 0x50 0x4E 0x47
if (data[0] !== 137) {
  console.log("FAIL: byte 0 should be 137");
  process.exit(2);
}
if (data[1] !== 80) {
  console.log("FAIL: byte 1 should be 80 (P)");
  process.exit(3);
}

// Check high-byte region (bytes 8-11 are 0xFE 0xDC 0xBA 0x04)
if (data[8] !== 254) {
  console.log("FAIL: byte 8 should be 254");
  process.exit(4);
}
if (data[9] !== 220) {
  console.log("FAIL: byte 9 should be 220");
  process.exit(5);
}
if (data[11] !== 4) {
  console.log("FAIL: byte 11 should be 4");
  process.exit(6);
}

// Check ASCII bytes survived: T=84, E=69, S=83, T=84
if (data[12] !== 84) {
  console.log("FAIL: byte 12 should be 84 (T)");
  process.exit(7);
}

// Check trailing high bytes: 0x80 0xFF 0xAB 0x01
if (data[16] !== 128) {
  console.log("FAIL: byte 16 should be 128");
  process.exit(8);
}
if (data[17] !== 255) {
  console.log("FAIL: byte 17 should be 255");
  process.exit(9);
}
if (data[19] !== 1) {
  console.log("FAIL: byte 19 should be 1");
  process.exit(10);
}

console.log("TEST_PASSED");
