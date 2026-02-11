function testProcessPlatform(): void {
  const platform = process.platform;
  if (platform !== "linux") {
    console.log("Error: expected linux, got:");
    console.log(platform);
    process.exit(1);
  }

  if (process.platform !== "linux") {
    console.log("Error: direct access failed");
    process.exit(1);
  }

  console.log("TEST_PASSED");
}
testProcessPlatform();
