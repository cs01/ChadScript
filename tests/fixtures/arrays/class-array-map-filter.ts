class Item {
  name: string;
  value: number;
  constructor(n: string, v: number) {
    this.name = n;
    this.value = v;
  }
}

const items = [new Item("alpha", 10), new Item("beta", 20), new Item("gamma", 30)];

const names = items.map((item: Item): string => item.name);
console.log(names.join(","));

const big = items.filter((item: Item): boolean => item.value > 15);
console.log(big.length);

console.log("TEST_PASSED");
