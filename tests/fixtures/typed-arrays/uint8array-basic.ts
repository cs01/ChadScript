const arr = new Uint8Array(10);

arr[0] = 42;
arr[1] = 255;
arr[2] = 0;

if (arr[0] !== 42) {
  process.exit(1);
}
if (arr[1] !== 255) {
  process.exit(2);
}
if (arr[2] !== 0) {
  process.exit(3);
}
if (arr[3] !== 0) {
  process.exit(4);
}
if (arr.length !== 10) {
  process.exit(5);
}

console.log("TEST_PASSED");
