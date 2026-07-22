interface Box {
  value: number;
  name: string;
}
const b: Box = { value: 1, name: "a" };
b.value = 42;
b.name = "renamed";
console.log(b.value, b.name);
