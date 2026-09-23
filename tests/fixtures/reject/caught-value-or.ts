// @expect-reject: CS1248
try {
  throw "s";
} catch (e) {
  const ok = e || "fallback";
  console.log(String(ok));
}
