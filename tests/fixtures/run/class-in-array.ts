class Item {
  id: number;
  constructor(id: number) {
    this.id = id;
  }
  double(): number {
    return this.id * 2;
  }
}
const items: Item[] = [];
items.push(new Item(1));
items.push(new Item(2));
items.push(new Item(3));
let sum = 0;
for (const it of items) {
  sum += it.double();
}
console.log(sum);
