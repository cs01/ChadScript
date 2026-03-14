// @test-description: map entries iteration with destructuring

const m = new Map<string, string>();
m.set("a", "1");
m.set("b", "2");
m.set("c", "3");

let count = 0;
const keys: string[] = [];
const values: string[] = [];
for (const [key, value] of m.entries()) {
  keys.push(key);
  values.push(value);
  count = count + 1;
}

if (count !== 3) {
  console.log("FAIL count: " + String(count));
  process.exit(1);
}

if (keys.join(",") !== "a,b,c") {
  console.log("FAIL keys: " + keys.join(","));
  process.exit(1);
}

if (values.join(",") !== "1,2,3") {
  console.log("FAIL values: " + values.join(","));
  process.exit(1);
}

console.log("TEST_PASSED");
