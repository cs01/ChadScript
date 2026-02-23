// @test-description: dotenv auto-loading from .env file

// This test verifies that cs_load_dotenv() runs at startup without crashing
// and that environment variables still work normally afterwards.

// Verify existing env vars still work (dotenv didn't break getenv)
const pathVal = process.env.PATH;
if (pathVal.length === 0) {
  console.log("FAIL: PATH should not be empty after dotenv init");
  process.exit(1);
}

const home = process.env.HOME;
if (home.length === 0) {
  console.log("FAIL: HOME should not be empty after dotenv init");
  process.exit(1);
}

console.log("TEST_PASSED");
