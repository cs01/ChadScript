// Module-scope string array from .match() — tests global %StringArray* type
const parts = "hello world".match(/hello (\w+)/);
if (parts !== null) {
  console.log(parts[0]);
}
console.log("TEST_PASSED");
