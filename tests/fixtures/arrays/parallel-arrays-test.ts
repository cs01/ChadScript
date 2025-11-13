// Test accessing empty parallel string arrays like argparse does

class Parser {
  parsedPositionals: string[];

  constructor() {
    this.parsedPositionals = [];
  }

  getPositional(index: number): string {
    console.log("Getting positional at index: " + index);
    console.log("Array length: " + this.parsedPositionals.length);
    
    if (index < this.parsedPositionals.length) {
      return this.parsedPositionals[index];
    }
    return "";
  }
}

const p = new Parser();
const result = p.getPositional(0);

console.log("Got result");

if (result.length === 0) {
  console.log("Result is empty - SUCCESS");
  process.exit(10);
}

console.log("FAIL");
process.exit(1);
