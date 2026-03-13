interface Config {
  name: string;
  value: number;
}

class Registry {
  items: Config[];
  count: number;

  constructor() {
    this.items = [];
    this.count = 0;
  }

  add(item: Config): void {
    this.items.push(item);
    this.count = this.count + 1;
  }

  getCount(): number {
    return this.count;
  }

  getAllNames(): string[] {
    const names: string[] = [];
    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i];
      names.push(item.name);
    }
    return names;
  }
}

const reg = new Registry();
reg.add({ name: "alpha", value: 1 });
reg.add({ name: "beta", value: 2 });
reg.add({ name: "gamma", value: 3 });

if (reg.getCount() !== 3) {
  process.exit(1);
}

const names = reg.getAllNames();
if (names.length !== 3) {
  process.exit(1);
}
if (names[0] !== "alpha") {
  process.exit(1);
}
if (names[2] !== "gamma") {
  process.exit(1);
}

console.log("TEST_PASSED");
