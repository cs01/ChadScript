// @expect-reject: CS1248
try {
  throw "s";
} catch (e) {
  e = "replaced";
  console.log(String(e));
}
