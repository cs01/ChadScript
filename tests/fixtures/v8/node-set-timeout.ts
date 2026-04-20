// @chadscript: interpret
// @test-skip
// @test-description: libnode pragma drains libuv: setTimeout callback fires before process exit
setTimeout(() => console.log("TEST_PASSED"), 50);
