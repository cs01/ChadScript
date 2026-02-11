function testProcessEnv(): void {
  const path = process.env.PATH;
  if (path.length === 0) {
    console.log("Error: PATH should not be empty");
    process.exit(1);
  }

  const home = process.env.HOME;
  if (home.length === 0) {
    console.log("Error: HOME should not be empty");
    process.exit(1);
  }

  console.log("TEST_PASSED");
}
testProcessEnv();
