class Item {
  label: string;
  count: number;
  constructor(label: string, count: number) {
    this.label = label;
    this.count = count;
  }
}

class Container {
  items: Item[];
  constructor() {
    this.items = [];
  }
  addItem(label: string, count: number): void {
    this.items.push(new Item(label, count));
  }
  getItems(): Item[] {
    return this.items;
  }
}

function main(): void {
  const c = new Container();
  c.addItem("x", 5);
  c.addItem("y", 10);

  const result = c.getItems();
  let sum = 0;
  for (let i = 0; i < result.length; i++) {
    sum = sum + result[i].count;
  }

  if (sum === 15) {
    console.log("TEST_PASSED");
  }
}

main();
