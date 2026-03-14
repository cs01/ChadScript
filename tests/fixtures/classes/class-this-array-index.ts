class Item {
  name: string;
  value: number;
  constructor(name: string, value: number) {
    this.name = name;
    this.value = value;
  }
}

class Container {
  items: Item[];
  constructor() {
    this.items = [];
  }

  add(name: string, value: number): void {
    this.items.push(new Item(name, value));
  }

  lookup(target: string): Item | null {
    for (let i = 0; i < this.items.length; i++) {
      const e = this.items[i];
      if (e.name === target) {
        return e;
      }
    }
    return null;
  }

  total(): number {
    let sum = 0;
    for (let i = 0; i < this.items.length; i++) {
      sum = sum + this.items[i].value;
    }
    return sum;
  }
}

function main(): void {
  const c = new Container();
  c.add("x", 10);
  c.add("y", 20);
  c.add("z", 30);
  const found = c.lookup("y");
  if (found !== null && found.value === 20 && c.total() === 60) {
    console.log("TEST_PASSED");
  }
}

main();
