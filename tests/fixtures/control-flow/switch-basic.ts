function testSwitch(): void {
  const x: number = 2;
  let result: string = "";

  switch (x) {
    case 1:
      result = "one";
      break;
    case 2:
      result = "two";
      break;
    case 3:
      result = "three";
      break;
    default:
      result = "other";
      break;
  }

  if (result !== "two") {
    console.log("FAIL: expected two, got " + result);
    process.exit(1);
  }

  const y: number = 99;
  let defaultHit: string = "";
  switch (y) {
    case 1:
      defaultHit = "nope";
      break;
    default:
      defaultHit = "default";
      break;
  }

  if (defaultHit !== "default") {
    console.log("FAIL: expected default, got " + defaultHit);
    process.exit(1);
  }

  console.log("TEST_PASSED");
}

testSwitch();
