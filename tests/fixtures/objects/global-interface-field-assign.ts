interface Counter {
  count: number;
  label: string;
}

function makeCounter(): Counter {
  return { count: 0, label: "default" };
}

const c = makeCounter();
c.count = 5;
c.label = "updated";
let passed = true;

if (c.count !== 5) {
  passed = false;
}
if (c.label !== "updated") {
  passed = false;
}

if (passed) {
  console.log("TEST_PASSED");
}
