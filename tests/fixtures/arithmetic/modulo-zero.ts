function getZero(): number {
  return 0;
}

function test(): void {
  const a = 10 % 3;
  if (a !== 1) {
    console.log("FAIL basic: " + a.toString());
    return;
  }

  const c = 7 % 2;
  if (c !== 1) {
    console.log("FAIL 7%2: " + c.toString());
    return;
  }

  const d = -10 % 3;
  if (d !== -1) {
    console.log("FAIL -10%3: " + d.toString());
    return;
  }

  const f = 10.5 % 3.0;
  if (f < 1.49 || f > 1.51) {
    console.log("FAIL 10.5%3.0: " + f.toString());
    return;
  }

  console.log("TEST_PASSED");
}
test();
