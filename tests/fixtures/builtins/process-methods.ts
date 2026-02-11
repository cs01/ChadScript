function testProcessMethods(): void {
  const uid = process.getuid();
  if (uid < 0) {
    console.log("Error: uid should be non-negative");
    process.exit(1);
  }

  const gid = process.getgid();
  if (gid < 0) {
    console.log("Error: gid should be non-negative");
    process.exit(1);
  }

  const euid = process.geteuid();
  if (euid < 0) {
    console.log("Error: euid should be non-negative");
    process.exit(1);
  }

  const egid = process.getegid();
  if (egid < 0) {
    console.log("Error: egid should be non-negative");
    process.exit(1);
  }

  const uptime = process.uptime();
  if (uptime <= 0) {
    console.log("Error: uptime should be positive");
    process.exit(1);
  }

  console.log("TEST_PASSED");
}
testProcessMethods();
