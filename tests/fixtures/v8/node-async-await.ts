// @chadscript: interpret
// @test-skip
// @test-description: libnode pragma supports async/await + Node fs.promises
const fs = require("fs").promises;

async function main() {
  const data = await fs.readFile(__filename, "utf8");
  const len = data.length;
  await new Promise((r) => setTimeout(r, 25));
  if (len > 0) {
    console.log("TEST_PASSED len=" + len);
  }
}

main();
