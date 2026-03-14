const chars = Array.from("hello");
if (chars.length === 5 && chars[0] === "h" && chars[4] === "o") {
  console.log("TEST_PASSED");
} else {
  console.log("FAIL: length=" + chars.length.toString());
}
