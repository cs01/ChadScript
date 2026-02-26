// Test JSON.stringify on an array of typed objects
interface Item {
  name: string;
  value: number;
}

const items: Item[] = [
  { name: "alpha", value: 1 },
  { name: "beta", value: 2 },
  { name: "gamma", value: 3 },
];

const json = JSON.stringify(items);

if (json.includes("alpha") && json.includes("beta") && json.includes("gamma")) {
  console.log("TEST_PASSED");
}
