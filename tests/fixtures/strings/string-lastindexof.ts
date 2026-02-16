const str = "hello world hello";

const last = str.lastIndexOf("hello");
const first = str.indexOf("hello");
const notFound = str.lastIndexOf("xyz");

if (last !== 12) {
  process.exit(1);
}
if (first !== 0) {
  process.exit(2);
}
if (notFound !== -1) {
  process.exit(3);
}

const single = "abcabc".lastIndexOf("bc");
if (single !== 4) {
  process.exit(4);
}

console.log("TEST_PASSED");
process.exit(0);
