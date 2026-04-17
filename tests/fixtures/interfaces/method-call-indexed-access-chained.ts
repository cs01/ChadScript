interface Thing {
  name: string;
  value: number;
}

class Store {
  items: Thing[] = [];
  push(t: Thing): void {
    this.items.push(t);
  }
  all(): Thing[] {
    return this.items;
  }
}

function main(): void {
  const s = new Store();
  s.push({ name: "a", value: 1 });
  s.push({ name: "b", value: 2 });
  if (s.all()[s.all().length - 1].name === "b") {
    console.log("TEST_PASSED");
  }
}

main();
