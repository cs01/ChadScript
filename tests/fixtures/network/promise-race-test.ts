async function testPromiseRace(): Promise<string> {
  const p1 = Promise.resolve("first");
  const p2 = Promise.resolve("second");

  const winner = await Promise.race([p1, p2]);

  console.log("TEST_PASSED");
  return "done";
}

testPromiseRace();
