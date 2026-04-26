class Registry {
  entries: Map<string, number> = new Map<string, number>();

  register(name: string, value: number): void {
    this.entries.set(name, value);
  }

  lookup(name: string): number {
    return this.entries.get(name);
  }
}

const r = new Registry();
r.register("x", 42);
r.register("y", 99);
if (r.lookup("x") === 42 && r.lookup("y") === 99) {
  console.log("TEST_PASSED");
}
