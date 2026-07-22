interface Item {
  name: string;
  price: number;
  inStock: boolean;
}
const it: Item = { name: "book", price: 12.5, inStock: true };
console.log(it.name, it.price, it.inStock);
console.log(`${it.name}: $${it.price}`);
