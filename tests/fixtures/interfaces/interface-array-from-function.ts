// @test-description: interface array returned from function with element access

interface KV {
  key: string;
  value: string;
}

function buildPairs(n: number): KV[] {
  const result: KV[] = [];
  for (let i = 0; i < n; i++) {
    result.push({ key: "key-" + i.toString(), value: "val-" + i.toString() });
  }
  return result;
}

const pairs = buildPairs(50);
const last = pairs[49];
if (last.key !== "key-49") {
  console.log("FAIL: last key " + last.key);
  process.exit(1);
}
if (last.value !== "val-49") {
  console.log("FAIL: last value");
  process.exit(1);
}

const filtered: KV[] = [];
for (let i = 0; i < pairs.length; i++) {
  const p = pairs[i];
  if (p.key === "key-25") {
    filtered.push(p);
  }
}
if (filtered.length !== 1) {
  console.log("FAIL: filtered length");
  process.exit(1);
}
if (filtered[0].value !== "val-25") {
  console.log("FAIL: filtered value");
  process.exit(1);
}
console.log("TEST_PASSED");
