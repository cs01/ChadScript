// Test getting a string from an empty string array class field

class Holder {
  items: string[];

  constructor() {
    this.items = [];
  }

  getItem(index: number): string {
    if (index < this.items.length) {
      return this.items[index];
    }
    return "";
  }
}

const h = new Holder();
const result = h.getItem(0);

console.log("Got result");

if (result.length === 0) {
  console.log("Result is empty - SUCCESS");
  process.exit(10);
}

console.log("Result is NOT empty - FAIL");
process.exit(1);
