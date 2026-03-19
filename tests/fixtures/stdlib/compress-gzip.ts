import { gzip, gunzip } from "chadscript/compress";

const input = new Uint8Array(5);
input[0] = 72;
input[1] = 101;
input[2] = 108;
input[3] = 108;
input[4] = 111;

const compressed = gzip(input);
if (compressed.length > 0) {
  const decompressed = gunzip(compressed);
  if (decompressed.length === 5 && decompressed[0] === 72 && decompressed[4] === 111) {
    console.log("TEST_PASSED");
  }
}
