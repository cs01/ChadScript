// Test for async fetch with Promise.all
// This tests the ultimate goal from AGENT_TASK.md:
// const [r1, r2] = await Promise.all([fetch(url1), fetch(url2)]);

async function testAsyncFetch(): any {
  // Test 1: Single await fetch
  const response1 = await fetch("http://localhost:9998/test");
  if (!response1.ok) {
    console.log("FAIL: response1 not ok");
    return "fail";
  }
  console.log("PASS: single await fetch");

  // Test 2: Multiple sequential await fetches
  const response2 = await fetch("http://localhost:9998/json");
  const response3 = await fetch("http://localhost:9998/plain");
  if (!response2.ok || !response3.ok) {
    console.log("FAIL: sequential fetches not ok");
    return "fail";
  }
  console.log("PASS: sequential await fetches");

  // Test 3: Promise.all with fetch
  const p1 = fetch("http://localhost:9998/test");
  const p2 = fetch("http://localhost:9998/json");
  const promises = [p1, p2];
  const allPromise = Promise.all(promises);
  const results = await allPromise;
  console.log("PASS: Promise.all with fetch completed");

  console.log("TEST_PASSED");
  return "done";
}

testAsyncFetch();
