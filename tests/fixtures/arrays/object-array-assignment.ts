interface Item {
  name: string;
  value: number;
}

const items: Item[] = [];
items.push({ name: "first", value: 1 });
items.push({ name: "second", value: 2 });
items.push({ name: "third", value: 3 });

items[1] = { name: "replaced", value: 99 };

console.log(items[0].name);
console.log(items[1].name);
console.log(items[1].value.toFixed(0));
console.log(items[2].name);

console.log("TEST_PASSED");
