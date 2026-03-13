const m = new Map<string, string>();
m.set("name", "Chad");
m.set("lang", "TypeScript");

const keys = m.keys();
const values = m.values();

if (keys.length !== 2) {
  process.exit(1);
}

if (values.length !== 2) {
  process.exit(1);
}

console.log("TEST_PASSED");
