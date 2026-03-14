class Wrapper {
  value: number;
  constructor(value: number) {
    this.value = value;
  }
}

function findWrapper(items: Wrapper[], target: number): Wrapper | null {
  for (let i = 0; i < items.length; i++) {
    if (items[i].value === target) {
      return items[i];
    }
  }
  return null;
}

function sumValues(items: Wrapper[]): number {
  let total = 0;
  for (let i = 0; i < items.length; i++) {
    total = total + items[i].value;
  }
  return total;
}

function main(): void {
  const items: Wrapper[] = [];
  items.push(new Wrapper(10));
  items.push(new Wrapper(20));
  items.push(new Wrapper(30));

  const sum = sumValues(items);
  const found = findWrapper(items, 20);
  if (found !== null && sum === 60 && found.value === 20) {
    console.log("TEST_PASSED");
  }
}
main();
