function test(): void {
  const fn = (x: number): number => x * 2;
  if (typeof fn !== "function") {
    console.log("FAIL arrow: " + typeof fn);
    return;
  }
  const t = true;
  if (typeof t !== "boolean") {
    console.log("FAIL bool: " + typeof t);
    return;
  }
  if (typeof 42 !== "number") {
    console.log("FAIL number");
    return;
  }
  if (typeof "hello" !== "string") {
    console.log("FAIL string");
    return;
  }
  if (typeof null !== "object") {
    console.log("FAIL null: " + typeof null);
    return;
  }
  if (typeof undefined !== "undefined") {
    console.log("FAIL undefined: " + typeof undefined);
    return;
  }
  console.log("TEST_PASSED");
}
test();
