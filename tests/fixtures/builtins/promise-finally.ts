async function main(): Promise<void> {
  const p = Promise.resolve("hello");
  const result: string = await p.finally(() => {
    console.log("cleanup");
  });

  if (result === "hello") {
    console.log("TEST_PASSED");
  }
}

main();
