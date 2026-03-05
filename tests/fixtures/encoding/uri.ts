// @test-description: encodeURIComponent/decodeURIComponent round-trip

const encoded = encodeURIComponent("hello world & foo=bar");
if (encoded !== "hello%20world%20%26%20foo%3Dbar") {
  console.log("FAIL: encodeURIComponent got '" + encoded + "'");
  process.exit(1);
}

const decoded = decodeURIComponent("hello%20world%20%26%20foo%3Dbar");
if (decoded !== "hello world & foo=bar") {
  console.log("FAIL: decodeURIComponent got '" + decoded + "'");
  process.exit(1);
}

const round = decodeURIComponent(encodeURIComponent("path/to?resource#hash"));
if (round !== "path/to?resource#hash") {
  console.log("FAIL: round-trip got '" + round + "'");
  process.exit(1);
}

console.log("TEST_PASSED");
