// @known-bug: reading `.message` of a caught Error narrowed by instanceof segfaults (O0 and O2); found writing the docs errors example
try {
  throw new Error("x");
} catch (e) {
  if (e instanceof Error) console.log("error:", e.message);
}
console.log("done");
