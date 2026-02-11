function testNumberIsFinite(): void {
  if (!Number.isFinite(42)) {
    console.log("Error: 42 should be finite");
    process.exit(1);
  }

  if (!Number.isFinite(0)) {
    console.log("Error: 0 should be finite");
    process.exit(1);
  }

  if (!Number.isFinite(-3.14)) {
    console.log("Error: -3.14 should be finite");
    process.exit(1);
  }

  console.log("TEST_PASSED");
}

function testNumberIsNaN(): void {
  if (Number.isNaN(42)) {
    console.log("Error: 42 should not be NaN");
    process.exit(1);
  }

  if (Number.isNaN(0)) {
    console.log("Error: 0 should not be NaN");
    process.exit(1);
  }

  console.log("TEST_PASSED");
}

function testNumberIsInteger(): void {
  if (!Number.isInteger(42)) {
    console.log("Error: 42 should be integer");
    process.exit(1);
  }

  if (!Number.isInteger(0)) {
    console.log("Error: 0 should be integer");
    process.exit(1);
  }

  if (Number.isInteger(3.14)) {
    console.log("Error: 3.14 should not be integer");
    process.exit(1);
  }

  console.log("TEST_PASSED");
}

function testNumberToString(): void {
  const n: number = 42;
  const s = n.toString();
  if (s !== "42") {
    console.log("Error: 42.toString() should be '42'");
    console.log(s);
    process.exit(1);
  }

  const pi: number = 3.14;
  const ps = pi.toString();
  if (ps !== "3.14") {
    console.log("Error: 3.14.toString() should be '3.14'");
    console.log(ps);
    process.exit(1);
  }

  console.log("TEST_PASSED");
}

testNumberIsFinite();
testNumberIsNaN();
testNumberIsInteger();
testNumberToString();
