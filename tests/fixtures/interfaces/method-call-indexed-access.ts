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
  const last = s.all()[s.all().length - 1];
  if (last.name === "b" && last.value === 2) {
    console.log("TEST_PASSED");
  }
}

main();
