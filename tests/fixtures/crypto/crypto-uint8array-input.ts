// crypto.md5 / sha256 / hmacSha256 accept Uint8Array input.
// Strings with embedded NUL would be truncated at the NUL by strlen —
// Uint8Array carries an explicit length, so the full payload is hashed.

const buf = new Uint8Array(5);
buf[0] = 97; // 'a'
buf[1] = 98; // 'b'
buf[2] = 0; // NUL
buf[3] = 99; // 'c'
buf[4] = 100; // 'd'

const h = crypto.md5(buf);
// md5 of "ab" alone (if NUL truncated) = 187ef4436122d1cc2f40dc2b92f0eba0
// md5 of full "ab\x00cd" should differ.
if (h === "187ef4436122d1cc2f40dc2b92f0eba0") {
  console.log("FAIL md5 NUL-truncated: " + h);
  process.exit(1);
}
if (h.length !== 32) {
  console.log("FAIL md5 len: " + h);
  process.exit(1);
}

const s = crypto.sha256(buf);
// sha256 of "ab" = fb8e20fc2e4c3f248c60c39bd652f3c1347298bb977b8b4d5903b85055620603
if (s === "fb8e20fc2e4c3f248c60c39bd652f3c1347298bb977b8b4d5903b85055620603") {
  console.log("FAIL sha256 truncated: " + s);
  process.exit(1);
}
if (s.length !== 64) {
  console.log("FAIL sha256 len: " + s);
  process.exit(1);
}

// HMAC-SHA256 with binary key + binary data
const key = new Uint8Array(3);
key[0] = 0;
key[1] = 1;
key[2] = 2;
const data = new Uint8Array(3);
data[0] = 3;
data[1] = 0;
data[2] = 4;
const mac: string = crypto.hmacSha256(key, data);
if (mac.length !== 64) {
  console.log("FAIL hmac len: " + mac);
  process.exit(1);
}

console.log("TEST_PASSED");
