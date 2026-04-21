// @chadscript: interpret
// @test-skip
// @test-description: libnode pragma supports Node 18+ native fetch
async function main() {
  const res = await fetch("https://httpbin.org/uuid");
  const body = await res.json();
  if (typeof body.uuid === "string" && body.uuid.length > 30) {
    console.log("TEST_PASSED");
  } else {
    console.log("FAIL " + JSON.stringify(body));
  }
}

main();
