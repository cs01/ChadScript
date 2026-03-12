function test(): void {
  const s = "hello";

  if (s.at(0) !== "h") {
    console.log("FAIL at(0): " + s.at(0));
    return;
  }

  if (s.at(4) !== "o") {
    console.log("FAIL at(4): " + s.at(4));
    return;
  }

  if (s.at(-1) !== "o") {
    console.log("FAIL at(-1): " + s.at(-1));
    return;
  }

  if (s.at(-5) !== "h") {
    console.log("FAIL at(-5): " + s.at(-5));
    return;
  }

  if (s.at(5) !== "") {
    console.log("FAIL at(5) oob: " + s.at(5));
    return;
  }

  if (s.at(-6) !== "") {
    console.log("FAIL at(-6) oob: " + s.at(-6));
    return;
  }

  console.log("TEST_PASSED");
}
test();
