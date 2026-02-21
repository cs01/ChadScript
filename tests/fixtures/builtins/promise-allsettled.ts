async function main(): Promise<void> {
  const p1 = Promise.resolve("hello");
  const p2 = Promise.reject("err");
  const p3 = Promise.resolve("world");

  const results = await Promise.allSettled([p1, p2, p3]);

  if (results.length === 3) {
    console.log("TEST_PASSED");
  }
}

main();
