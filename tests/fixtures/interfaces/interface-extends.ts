interface Base {
  id: number;
  name: string;
}

interface Extended extends Base {
  extra: string;
}

function testInterfaceExtends(): void {
  const obj: Extended = { id: 42, name: "Alice", extra: "bonus" };
  if (obj.id !== 42) {
    console.log("FAIL: id should be 42");
    process.exit(1);
  }
  if (obj.name !== "Alice") {
    console.log("FAIL: name should be Alice");
    process.exit(1);
  }
  if (obj.extra !== "bonus") {
    console.log("FAIL: extra should be bonus");
    process.exit(1);
  }
  console.log("TEST_PASSED");
}

testInterfaceExtends();
