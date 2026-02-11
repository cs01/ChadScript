function testTrimStart(): void {
  const s = "  hello  ";
  const result = s.trimStart();
  if (result !== "hello  ") {
    console.log("Error: trimStart failed");
    process.exit(1);
  }

  const s2 = "   ";
  const result2 = s2.trimStart();
  if (result2 !== "") {
    console.log("Error: trimStart all whitespace should return empty");
    process.exit(1);
  }

  const s3 = "hello";
  const result3 = s3.trimStart();
  if (result3 !== "hello") {
    console.log("Error: trimStart no whitespace should return original");
    process.exit(1);
  }

  const s4 = "";
  const result4 = s4.trimStart();
  if (result4 !== "") {
    console.log("Error: trimStart empty string should return empty");
    process.exit(1);
  }

  console.log("TEST_PASSED");
}

function testTrimEnd(): void {
  const s = "  hello  ";
  const result = s.trimEnd();
  if (result !== "  hello") {
    console.log("Error: trimEnd failed");
    process.exit(1);
  }

  const s2 = "   ";
  const result2 = s2.trimEnd();
  if (result2 !== "") {
    console.log("Error: trimEnd all whitespace should return empty");
    process.exit(1);
  }

  const s3 = "hello";
  const result3 = s3.trimEnd();
  if (result3 !== "hello") {
    console.log("Error: trimEnd no whitespace should return original");
    process.exit(1);
  }

  const s4 = "";
  const result4 = s4.trimEnd();
  if (result4 !== "") {
    console.log("Error: trimEnd empty string should return empty");
    process.exit(1);
  }

  console.log("TEST_PASSED");
}

testTrimStart();
testTrimEnd();
