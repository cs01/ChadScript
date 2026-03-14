class Entry {
  key: string;
  val: number;
  constructor(key: string, val: number) {
    this.key = key;
    this.val = val;
  }
}

class Store {
  entries: Entry[];
  constructor() {
    this.entries = [];
  }
  add(key: string, val: number): void {
    this.entries.push(new Entry(key, val));
  }
  getAll(): Entry[] {
    return this.entries;
  }
}

const store = new Store();
store.add("a", 1);
store.add("b", 2);
store.add("c", 3);

let sum = 0;
let keys = "";
for (const e of store.getAll()) {
  sum = sum + e.val;
  keys = keys + e.key;
}

if (sum === 6 && keys === "abc") {
  console.log("TEST_PASSED");
}
