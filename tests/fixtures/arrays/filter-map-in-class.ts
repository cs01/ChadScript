class FilterStore {
  filtered: number[];
  mapped: string[];

  constructor(items: number[]) {
    this.filtered = items.filter((x: number): boolean => x > 2);
    this.mapped = ["hello", "world", "test"].map((s: string): string => s + "!");
  }

  getFiltered(): number[] {
    return this.filtered;
  }

  getMapped(): string[] {
    return this.mapped;
  }
}

const store = new FilterStore([1, 2, 3, 4, 5]);
const f = store.getFiltered();
const m = store.getMapped();

if (f.length === 3 && f[0] === 3 && f[1] === 4 && f[2] === 5) {
  if (m.length === 3 && m[0] === "hello!" && m[1] === "world!") {
    console.log("TEST_PASSED");
  }
}
