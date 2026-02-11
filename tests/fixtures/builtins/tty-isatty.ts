function testIsatty(): void {
  const stdinIsTty = tty.isatty(0);
  const stdoutIsTty = tty.isatty(1);
  const invalidFd = tty.isatty(999);

  if (invalidFd) {
    console.log("Error: fd 999 should not be a tty");
    process.exit(1);
  }

  console.log("TEST_PASSED");
}
testIsatty();
