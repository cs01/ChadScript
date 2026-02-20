interface Item {
  id: number;
  name: string;
  value: number;
  active: boolean;
}

const jsonStr = '{"id":42,"name":"widget","value":3.14,"active":true}';
const item = JSON.parse<Item>(jsonStr);

if (item.id !== 42) {
  throw new Error("Expected id to be 42, got " + item.id);
}
if (item.name !== "widget") {
  throw new Error("Expected name to be widget");
}
if (item.value !== 3.14) {
  throw new Error("Expected value to be 3.14");
}

const items: Item[] = [];
let i = 0;
while (i < 3) {
  const s = '{"id":' + i + ',"name":"item' + i + '","value":' + i * 2.5 + ',"active":true}';
  items.push(JSON.parse<Item>(s));
  i = i + 1;
}

if (items[0].id !== 0) {
  throw new Error("Expected items[0].id to be 0");
}
if (items[2].name !== "item2") {
  throw new Error("Expected items[2].name to be item2");
}

console.log("TEST_PASSED");
