class Item {
  name: string;
  value: number;
  constructor(name: string, value: number) {
    this.name = name;
    this.value = value;
  }
}

class Inventory {
  items: Item[];
  constructor() {
    this.items = [];
  }

  addItem(name: string, value: number): void {
    this.items.push(new Item(name, value));
  }

  describeExpensive(): string {
    const expensive = this.items.filter((item: Item): boolean => item.value >= 50);
    let result = "";
    for (const e of expensive) {
      result = result + e.name + ",";
    }
    return result;
  }

  listNames(): string {
    const names = this.items.map((item: Item): string => item.name);
    let result = "";
    for (const n of names) {
      result = result + n + ",";
    }
    return result;
  }
}

function main(): void {
  const inv = new Inventory();
  inv.addItem("sword", 100);
  inv.addItem("potion", 25);
  inv.addItem("shield", 75);

  const expensive = inv.describeExpensive();
  const names = inv.listNames();

  if (expensive === "sword,shield," && names === "sword,potion,shield,") {
    console.log("TEST_PASSED");
  } else {
    console.log("FAIL filter=" + expensive + " map=" + names);
  }
}

main();
