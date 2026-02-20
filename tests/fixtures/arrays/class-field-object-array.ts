interface Item {
  name: string;
  value: number;
  active: boolean;
}

class Container {
  items: Item[];

  constructor() {
    this.items = [];
  }

  addItem(name: string, value: number, active: boolean): void {
    this.items.push({ name: name, value: value, active: active });
  }

  getName(i: number): string {
    return this.items[i].name;
  }

  getValue(i: number): number {
    return this.items[i].value;
  }

  isActive(i: number): boolean {
    return this.items[i].active;
  }

  setName(i: number, n: string): void {
    this.items[i].name = n;
  }

  setValue(i: number, v: number): void {
    this.items[i].value = v;
  }

  setActive(i: number, a: boolean): void {
    this.items[i].active = a;
  }

  count(): number {
    return this.items.length;
  }

  printAll(): void {
    let i = 0;
    while (i < this.items.length) {
      console.log(this.items[i].name + ":" + this.items[i].value.toFixed(0));
      i = i + 1;
    }
  }
}

const c = new Container();
c.addItem("alpha", 10, true);
c.addItem("beta", 20, false);
c.addItem("gamma", 30, true);

let ok = true;

if (c.count() !== 3) { ok = false; }
if (c.getName(0) !== "alpha") { ok = false; }
if (c.getValue(1) !== 20) { ok = false; }
if (c.isActive(2) !== true) { ok = false; }
if (c.isActive(1) !== false) { ok = false; }

c.setName(0, "ALPHA");
c.setValue(1, 99);
c.setActive(2, false);

if (c.getName(0) !== "ALPHA") { ok = false; }
if (c.getValue(1) !== 99) { ok = false; }
if (c.isActive(2) !== false) { ok = false; }

c.printAll();

if (ok) {
  console.log("TEST_PASSED");
}
