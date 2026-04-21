// @test-description: string | null narrows to string after !== null guard
function maybeStr(flag: boolean): string | null {
  if (flag) return "hello";
  return null;
}

const a = maybeStr(true);
let passed = false;
if (a !== null) {
  // After the narrowing guard, string methods must work on `a`.
  if (a.length === 5 && a.toUpperCase() === "HELLO") {
    passed = true;
  }
}
const b = maybeStr(false);
if (b === null && passed) {
  console.log("TEST_PASSED");
}
