class Splitter {
  parts: string[];

  constructor(input: string, delim: string) {
    this.parts = input.split(delim);
  }

  getFirst(): string {
    return this.parts[0];
  }

  count(): number {
    return this.parts.length;
  }
}

const s = new Splitter("a,b,c", ",");
if (s.count() === 3 && s.getFirst() === "a") {
  console.log("TEST_PASSED");
}
