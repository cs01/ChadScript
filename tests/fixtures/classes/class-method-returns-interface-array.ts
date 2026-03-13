interface Entry {
  key: string;
  value: number;
}

class Store {
  entries: Entry[];

  constructor() {
    this.entries = [];
  }

  add(key: string, value: number): void {
    this.entries.push({ key: key, value: value });
  }

  getFiltered(minValue: number): Entry[] {
    const result: Entry[] = [];
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i];
      if (e.value >= minValue) {
        result.push(e);
      }
    }
    return result;
  }
}

const store = new Store();
store.add("a", 10);
store.add("b", 5);
store.add("c", 20);
store.add("d", 3);
const filtered = store.getFiltered(10);
if (filtered.length !== 2) {
  process.exit(1);
}
console.log("TEST_PASSED");
