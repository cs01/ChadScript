function test(): void {
  let x = 1;
  if (true) {
    let x = 2;
    if (x !== 2) {
      console.log("FAIL inner: " + x);
      return;
    }
  }
  if (x !== 1) {
    console.log("FAIL outer after if: " + x);
    return;
  }

  let y = "hello";
  if (true) {
    let y = "world";
    if (y !== "world") {
      console.log("FAIL inner string: " + y);
      return;
    }
  }
  if (y !== "hello") {
    console.log("FAIL outer string: " + y);
    return;
  }

  let z = 10;
  if (true) {
    let z = 20;
    if (true) {
      let z = 30;
      if (z !== 30) {
        console.log("FAIL nested inner: " + z);
        return;
      }
    }
    if (z !== 20) {
      console.log("FAIL nested middle: " + z);
      return;
    }
  }
  if (z !== 10) {
    console.log("FAIL nested outer: " + z);
    return;
  }

  console.log("TEST_PASSED");
}
test();
