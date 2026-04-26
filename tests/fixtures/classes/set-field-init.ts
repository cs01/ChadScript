class Container {
  items: Set<string> = new Set<string>();

  hasItem(name: string): boolean {
    return this.items.has(name);
  }
}

const c = new Container();
c.items.add("hello");
c.items.add("world");
if (c.hasItem("hello") && c.hasItem("world") && !c.hasItem("missing")) {
  console.log("TEST_PASSED");
}
