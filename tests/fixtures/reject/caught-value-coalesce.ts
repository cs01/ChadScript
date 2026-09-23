// @expect-reject: CS1248
try {
  throw "s";
} catch (e) {
  console.log(String(e ?? "none"));
}
