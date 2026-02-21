async function main(): Promise<void> {
  const p1 = Promise.reject("fail1");
  const p2 = Promise.resolve("winner");
  const p3 = Promise.resolve("also");

  const result: string = await Promise.any([p1, p2, p3]);

  if (result === "winner") {
    console.log("TEST_PASSED");
  }
}

main();
