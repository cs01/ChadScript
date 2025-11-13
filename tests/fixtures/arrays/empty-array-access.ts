// Test empty string array access and comparison
// This should reproduce the argparse-cli segfault

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

console.log("Got result: '" + result + "'");
console.log("Length: " + result.length);

// This is what argparse-cli does that crashes
if (result.length === 0) {
  console.log("Result is empty");
} else {
  console.log("Result is NOT empty!");
}

console.log("Done");
process.exit(42);
