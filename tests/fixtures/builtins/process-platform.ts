function testProcessPlatform(): void {
  const platform = process.platform;
  if (platform.length === 0) {
    console.log("Error: platform is empty");
    process.exit(1);
  }

  if (process.platform !== platform) {
    console.log("Error: direct access differs from cached");
    process.exit(1);
  }

  console.log("TEST_PASSED");
}
testProcessPlatform();
