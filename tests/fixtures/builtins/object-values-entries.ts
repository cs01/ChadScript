function testObjectValues(): void {
  const obj = { name: "alice", city: "nyc" };
  const vals = Object.values(obj);

  if (vals.length !== 2) {
    console.log("Error: expected 2 values");
    process.exit(1);
  }

  if (vals[0] !== "alice") {
    console.log("Error: first value should be alice");
    process.exit(1);
  }

  if (vals[1] !== "nyc") {
    console.log("Error: second value should be nyc");
    process.exit(1);
  }

  console.log("TEST_PASSED");
}

function testObjectKeys(): void {
  const obj = { name: "bob", age: "30" };
  const keys = Object.keys(obj);

  if (keys.length !== 2) {
    console.log("Error: expected 2 keys");
    process.exit(1);
  }

  if (keys[0] !== "name") {
    console.log("Error: first key should be name");
    process.exit(1);
  }

  if (keys[1] !== "age") {
    console.log("Error: second key should be age");
    process.exit(1);
  }

  console.log("TEST_PASSED");
}

function testObjectEntries(): void {
  const obj = { x: "hello", y: "world" };
  const entries = Object.entries(obj);

  if (entries.length !== 4) {
    console.log("Error: expected 4 entries (flat key-value pairs)");
    process.exit(1);
  }

  if (entries[0] !== "x") {
    console.log("Error: first entry key should be x");
    process.exit(1);
  }

  if (entries[1] !== "hello") {
    console.log("Error: first entry value should be hello");
    process.exit(1);
  }

  if (entries[2] !== "y") {
    console.log("Error: second entry key should be y");
    process.exit(1);
  }

  if (entries[3] !== "world") {
    console.log("Error: second entry value should be world");
    process.exit(1);
  }

  console.log("TEST_PASSED");
}

testObjectValues();
testObjectKeys();
testObjectEntries();
