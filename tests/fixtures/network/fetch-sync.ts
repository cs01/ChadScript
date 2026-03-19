// @test-skip
// @test-description: sync fetch optimization - await fetch() bypasses promise/libuv

async function main(): Promise<string> {
  const response = await fetch("http://httpbin.org/get");
  console.log("status: " + response.status.toString());
  if (response.ok) {
    console.log("TEST_PASSED");
  }
  return "done";
}

main();
