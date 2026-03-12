// @test-description: charAt comparison optimization produces correct results
const str = "hello world";

if (str.charAt(0) === "h") {
  // pass
} else {
  process.exit(1);
}

if (str.charAt(4) === "o") {
  // pass
} else {
  process.exit(1);
}

if (str.charAt(0) !== "x") {
  // pass
} else {
  process.exit(1);
}

if (str.charAt(100) === "h") {
  process.exit(1);
}

if (str.charAt(-1) === "h") {
  process.exit(1);
}

if (str.charAt(100) !== "z") {
  // pass - OOB charAt !== anything is true
} else {
  process.exit(1);
}

let pos = 0;
if (str.charAt(pos) === "h") {
  // pass
} else {
  process.exit(1);
}

pos = 6;
if (str.charAt(pos) === "w") {
  // pass
} else {
  process.exit(1);
}

console.log("TEST_PASSED");
