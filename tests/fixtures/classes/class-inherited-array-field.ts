class Base {
  items: string[];
  label: string;

  constructor(label: string) {
    this.items = [];
    this.label = label;
  }

  addItem(item: string): void {
    this.items.push(item);
  }

  getCount(): number {
    return this.items.length;
  }
}

class Extended extends Base {
  priority: number;

  constructor(label: string, priority: number) {
    super(label);
    this.priority = priority;
  }

  addPrioritized(item: string): void {
    const prefixed = "[" + this.label + "] " + item;
    this.addItem(prefixed);
  }
}

const e = new Extended("test", 5);
e.addPrioritized("alpha");
e.addPrioritized("beta");
if (e.getCount() !== 2) {
  process.exit(1);
}
console.log("TEST_PASSED");
