class Item {
  name: string;
  value: number;
  constructor(name: string, value: number) {
    this.name = name;
    this.value = value;
  }
}

const items: Item[] = [];
items.push(new Item("apple", 3));
items.push(new Item("banana", 5));
items.push(new Item("cherry", 2));

let total: number = 0;
for (let i = 0; i < items.length; i++) {
  total = total + items[i].value;
}
console.log(total);
console.log(items.length);
console.log(items[0].name);
console.log(items[1].name);
console.log(items[2].value);
