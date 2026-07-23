// Object destructuring in a for...of binding: `for (const { a, b: x } of items)`.
interface Row {
  id: number;
  name: string;
}
const rows: Row[] = [
  { id: 1, name: "alpha" },
  { id: 2, name: "beta" },
  { id: 3, name: "gamma" },
];
let total = 0;
for (const { id, name } of rows) {
  console.log(id, name.toUpperCase());
  total += id;
}
console.log("total", total);
for (const { id: n } of rows) {
  console.log(n * 10);
}
