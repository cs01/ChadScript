// @expect-reject: CS1248
try {
  throw "s";
} catch (e) {
  if (typeof e === "number") console.log(e + 1);
}
