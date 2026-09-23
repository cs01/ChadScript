// @expect-reject: CS1000
try {
  throw new Error("x");
} catch (e) {
  if (e instanceof Error) console.log(e.stack);
}
