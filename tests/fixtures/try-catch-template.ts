const code: number = 42;
try {
  throw "error code " + code;
} catch (e) {
  console.log("got:", e);
}
