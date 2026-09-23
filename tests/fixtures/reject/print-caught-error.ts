// @expect-reject: CS1238
// Node prints a caught Error with its stack trace (file paths).
try {
  throw new Error("x");
} catch (e) {
  console.log(e);
}
