async function testAsyncFetch(): Promise<string> {
  const response = await fetch("http://127.0.0.1:19878/test");
  if (response.ok) {
    const body = response.text();
    if (body === "/test") {
      console.log("TEST_PASSED");
    } else {
      console.log("Error: unexpected body: " + body);
      process.exit(1);
    }
  } else {
    console.log("Error: fetch failed");
    process.exit(1);
  }
  return "done";
}

testAsyncFetch();
