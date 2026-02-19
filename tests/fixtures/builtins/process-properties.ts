function testProcessProperties(): void {
  const arch = process.arch;
  if (arch !== "x64" && arch !== "arm64") {
    console.log("Error: expected x64 or arm64, got " + arch);
    process.exit(1);
  }

  const version = process.version;
  if (version !== "v1.0.0") {
    console.log("Error: expected v1.0.0");
    process.exit(1);
  }

  const pid = process.pid;
  if (pid <= 0) {
    console.log("Error: pid should be positive");
    process.exit(1);
  }

  const ppid = process.ppid;
  if (ppid <= 0) {
    console.log("Error: ppid should be positive");
    process.exit(1);
  }

  const execPath = process.execPath;
  if (execPath.length === 0) {
    console.log("Error: execPath should not be empty");
    process.exit(1);
  }

  const argv0 = process.argv0;
  if (argv0.length === 0) {
    console.log("Error: argv0 should not be empty");
    process.exit(1);
  }

  console.log("TEST_PASSED");
}
testProcessProperties();
