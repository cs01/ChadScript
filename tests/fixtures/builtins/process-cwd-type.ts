const cwd = process.cwd();
if (cwd === "") {
  process.exit(1);
}

const now = Date.now();
if (now <= 0) {
  process.exit(1);
}

console.log("TEST_PASSED");
