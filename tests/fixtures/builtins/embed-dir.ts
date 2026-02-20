ChadScript.embedDir("./embed-dir-data");

const html = ChadScript.getEmbeddedFile("index.html");
const css = ChadScript.getEmbeddedFile("style.css");
const missing = ChadScript.getEmbeddedFile("nonexistent.txt");

if (html.indexOf("<h1>Embedded Index</h1>") === -1) {
  console.log("FAIL: index.html content not found");
  process.exit(1);
}

if (css.indexOf("color: red") === -1) {
  console.log("FAIL: style.css content not found");
  process.exit(1);
}

if (missing !== "") {
  console.log("FAIL: nonexistent file should return empty string");
  process.exit(1);
}

console.log("TEST_PASSED");
