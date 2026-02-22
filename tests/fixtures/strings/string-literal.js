// @test-exit-code: 4
function getStringLength() {
  const message = "test";
  return message.length; // Should return 4
}

process.exit(getStringLength());
