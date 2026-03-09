class Helper {
  process(s: string): string {
    return s + "_processed";
  }
}

class Container {
  helper: Helper | null = null;

  setHelper(h: Helper): void {
    this.helper = h;
  }

  doWork(s: string): string {
    const result = this.helper?.process(s);
    if (result) return result;
    return "no_helper";
  }
}

const c = new Container();
if (c.doWork("test") !== "no_helper") {
  console.log("FAIL: expected no_helper");
  process.exit(1);
}
c.setHelper(new Helper());
if (c.doWork("test") !== "test_processed") {
  console.log("FAIL: expected test_processed");
  process.exit(1);
}
console.log("TEST_PASSED");
