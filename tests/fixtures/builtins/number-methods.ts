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

function testNumberToFixed(): void {
  const pi: number = 3.14159;
  const s2 = pi.toFixed(2);
  if (s2 !== "3.14") {
    console.log("Error: 3.14159.toFixed(2) should be '3.14', got:");
    console.log(s2);
    process.exit(1);
  }

  const n: number = 42;
  const s0 = n.toFixed(0);
  if (s0 !== "42") {
    console.log("Error: 42.toFixed(0) should be '42', got:");
    console.log(s0);
    process.exit(1);
  }

  const small: number = 0.1 + 0.2;
  const s1 = small.toFixed(1);
  if (s1 !== "0.3") {
    console.log("Error: (0.1+0.2).toFixed(1) should be '0.3', got:");
    console.log(s1);
    process.exit(1);
  }

  const neg: number = -5.678;
  const s3 = neg.toFixed(1);
  if (s3 !== "-5.7") {
    console.log("Error: (-5.678).toFixed(1) should be '-5.7', got:");
    console.log(s3);
    process.exit(1);
  }

  console.log("TEST_PASSED");
}

testNumberIsFinite();
testNumberIsNaN();
testNumberIsInteger();
testNumberToString();
testNumberToFixed();
