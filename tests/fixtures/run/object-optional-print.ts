interface Box {
  label: string;
  count?: number;
}
const b1: Box = { label: "a", count: 5 };
const b2: Box = { label: "b" };
console.log(b1.count);
console.log(b2.count);
console.log(b2.count === undefined);
