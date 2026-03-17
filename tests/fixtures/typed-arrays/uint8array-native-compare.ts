let passed = true;

const buf = new Uint8Array(4);
buf[0] = 0;
buf[1] = 65;
buf[2] = 255;
buf[3] = 128;

if (buf[0] !== 0) {
  console.log("FAIL: buf[0] !== 0");
  passed = false;
}
if (buf[1] !== 65) {
  console.log("FAIL: buf[1] !== 65");
  passed = false;
}
if (buf[2] !== 255) {
  console.log("FAIL: buf[2] !== 255");
  passed = false;
}
if (buf[1] === 66) {
  console.log("FAIL: buf[1] === 66 should be false");
  passed = false;
}
if (buf[3] < 127) {
  console.log("FAIL: buf[3] < 127 should be false");
  passed = false;
}
if (buf[3] > 129) {
  console.log("FAIL: buf[3] > 129 should be false");
  passed = false;
}
if (buf[0] >= 1) {
  console.log("FAIL: buf[0] >= 1 should be false");
  passed = false;
}
if (buf[2] <= 254) {
  console.log("FAIL: buf[2] <= 254 should be false");
  passed = false;
}

if (65 !== buf[1]) {
  console.log("FAIL: 65 !== buf[1] (swapped)");
  passed = false;
}

if (passed) {
  console.log("TEST_PASSED");
}
