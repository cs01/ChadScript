// @test-skip
function getPort(): string {
  const args = process.argv;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-p") {
      return args[i + 1];
    }
  }
  return "19880";
}

async function testPromiseAll(): Promise<string> {
  const port = getPort();
  const base = "http://127.0.0.1:" + port;
  const start = process.uptime();

  const p1 = fetch(base + "/slow/1");
  const p2 = fetch(base + "/slow/2");
  const p3 = fetch(base + "/slow/3");

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
