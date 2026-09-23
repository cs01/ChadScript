// @expect-reject: CS1248
try {
  throw "s";
} catch (e) {
  if (Array.isArray(e)) console.log(e.length);
}
