function testLogical(): void {
  const t: boolean = true;
  const f: boolean = false;

  if (!(t && t)) {
    console.log("FAIL: true && true");
    process.exit(1);
  }
  if (t && f) {
    console.log("FAIL: true && false");
    process.exit(1);
  }
  if (f && t) {
    console.log("FAIL: false && true");
    process.exit(1);
  }
  if (f && f) {
    console.log("FAIL: false && false");
    process.exit(1);
  }

  if (!(t || t)) {
    console.log("FAIL: true || true");
    process.exit(1);
  }
  if (!(t || f)) {
    console.log("FAIL: true || false");
    process.exit(1);
  }
  if (!(f || t)) {
    console.log("FAIL: false || true");
    process.exit(1);
  }
  if (f || f) {
    console.log("FAIL: false || false");
    process.exit(1);
  }

  if (!!f) {
    console.log("FAIL: !false");
    process.exit(1);
  }
  if (!t) {
    console.log("FAIL: !true should be false");
    process.exit(1);
  }

  console.log("TEST_PASSED");
}

testLogical();
