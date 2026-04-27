try {
  console.log("outer try");
  try {
    console.log("inner try");
    throw "inner error";
  } catch (e) {
    console.log("inner caught:", e);
  }
  console.log("outer continues");
  throw "outer error";
} catch (e) {
  console.log("outer caught:", e);
}
console.log("done");
