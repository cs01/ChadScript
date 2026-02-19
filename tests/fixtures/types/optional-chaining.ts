interface Nested {
  value: number;
}

interface Config {
  name: string;
  count: number;
}

function getConfig(): Config {
  return { name: "test", count: 10 };
}

const cfg = getConfig();
const n = cfg?.name;
const c = cfg?.count;

if (n !== "test") {
  process.exit(1);
}
if (c !== 10) {
  process.exit(2);
}

const s = "hello";
const len = s?.length;
if (len !== 5) {
  process.exit(3);
}

console.log("TEST_PASSED");
