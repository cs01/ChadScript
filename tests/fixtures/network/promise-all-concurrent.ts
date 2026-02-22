// @test-skip
async function testPromiseAll(): Promise<string> {
  const start = process.uptime();

  const p1 = fetch("http://127.0.0.1:19880/slow/1");
  const p2 = fetch("http://127.0.0.1:19880/slow/2");
  const p3 = fetch("http://127.0.0.1:19880/slow/3");

  const results = await Promise.all([p1, p2, p3]);

  const elapsed = process.uptime() - start;

  if (elapsed > 0.8) {
    console.log("Error: took too long, fetches ran sequentially");
    process.exit(1);
  }

  console.log("TEST_PASSED");
  return "done";
}

testPromiseAll();
