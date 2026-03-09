interface Item {
  name: string;
  value: number;
}

class Container {
  items: Item[] = [];

  addItem(name: string, value: number): void {
    this.items.push({ name: name, value: value });
  }

  sumValues(): number {
    let sum = 0;
    for (const item of this.items) {
      sum = sum + item.value;
    }
    return sum;
  }

  getNames(): string {
    let result = "";
    for (const item of this.items) {
      result = result + item.name + ",";
    }
    return result;
  }
}

const c = new Container();
c.addItem("a", 10);
c.addItem("b", 20);
c.addItem("c", 30);

let passed = true;

const sum = c.sumValues();
if (sum !== 60) {
  console.log("FAIL: sum expected 60 got " + sum);
  passed = false;
}

const names = c.getNames();
if (names !== "a,b,c,") {
  console.log("FAIL: names expected 'a,b,c,' got '" + names + "'");
  passed = false;
}

if (passed) {
  console.log("TEST_PASSED");
}
