function format(value: number, prefix?: string): string {
  if (prefix) {
    return prefix + String(value);
  }
  return String(value);
}

const a = format(42);
const b = format(42, "$");
if (a === "42" && b === "$42") {
  console.log("TEST_PASSED");
}
