class Item {
  name: string;
  value: number;
  constructor(name: string, value: number) {
    this.name = name;
    this.value = value;
  }
}

const items: Item[] = [];
items.push(new Item("a", 10));
items.push(new Item("b", 20));
items.push(new Item("c", 30));

let total = 0;
let names = "";
for (const item of items) {
  total = total + item.value;
  names = names + item.name;
}

if (total === 60 && names === "abc") {
  console.log("TEST_PASSED");
}
