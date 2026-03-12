function testSwitchString(): void {
  const color: string = "green";
  let code: number = 0;

  switch (color) {
    case "red":
      code = 1;
      break;
    case "green":
      code = 2;
      break;
    case "blue":
      code = 3;
      break;
    default:
      code = -1;
      break;
  }

  if (code !== 2) {
    console.log("FAIL: expected 2, got " + code);
    process.exit(1);
  }

  console.log("TEST_PASSED");
}

testSwitchString();
