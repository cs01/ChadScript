// @test-args: hello world 42
const args = process.argv;

if (args.length !== 3) {
  console.log("FAIL: expected 3 args, got " + args.length);
  process.exit(1);
}

if (args[0] !== "hello") {
  console.log("FAIL: argv[0] should be hello, got " + args[0]);
  process.exit(1);
}

if (args[1] !== "world") {
  console.log("FAIL: argv[1] should be world, got " + args[1]);
  process.exit(1);
}

if (args[2] !== "42") {
  console.log("FAIL: argv[2] should be 42, got " + args[2]);
  process.exit(1);
}

const execPath = process.argv0;
if (execPath.length === 0) {
  console.log("FAIL: process.argv0 should not be empty");
  process.exit(1);
}

console.log("TEST_PASSED");
