try {
  throw new Error("x");
} catch (e) {
  if (e instanceof Error) console.log("error:", e.message);
}
console.log("done");
