// Test empty string array access
class StringHolder {
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

const holder = new StringHolder();
const result = holder.getItem(0);

if (result.length === 0) {
  console.log("SUCCESS");
  process.exit(42);
}

console.log("FAIL");
process.exit(1);
