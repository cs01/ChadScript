const str = "hello world";

const idx1 = str.indexOf("o");
if (idx1 !== 4) {
  console.log("FAIL: indexOf single char expected 4, got " + idx1);
  process.exit(1);
}

const idx2 = str.indexOf("o", 5);
if (idx2 !== 7) {
  console.log("FAIL: indexOf single char from 5 expected 7, got " + idx2);
  process.exit(1);
}

const idx3 = str.indexOf("z");
if (idx3 !== -1) {
  console.log("FAIL: indexOf single char not found expected -1, got " + idx3);
  process.exit(1);
}

const idx4 = str.indexOf("\n");
if (idx4 !== -1) {
  console.log("FAIL: indexOf newline expected -1, got " + idx4);
  process.exit(1);
}

const withNewline = "line1\nline2";
const idx5 = withNewline.indexOf("\n");
if (idx5 !== 5) {
  console.log("FAIL: indexOf newline expected 5, got " + idx5);
  process.exit(1);
}

const idx6 = withNewline.indexOf("\n", 6);
if (idx6 !== -1) {
  console.log("FAIL: indexOf newline from 6 expected -1, got " + idx6);
  process.exit(1);
}

const idx7 = str.indexOf("h");
if (idx7 !== 0) {
  console.log("FAIL: indexOf first char expected 0, got " + idx7);
  process.exit(1);
}

const idx8 = str.indexOf("d");
if (idx8 !== 10) {
  console.log("FAIL: indexOf last char expected 10, got " + idx8);
  process.exit(1);
}

const idx9 = str.indexOf("o", -1);
if (idx9 !== 4) {
  console.log("FAIL: indexOf from negative expected 4, got " + idx9);
  process.exit(1);
}

const idx10 = str.indexOf("o", 100);
if (idx10 !== -1) {
  console.log("FAIL: indexOf from past end expected -1, got " + idx10);
  process.exit(1);
}

console.log("TEST_PASSED");
