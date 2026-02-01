function outer(): number {
  const x: number = 10;
  const add = (n) => n + x;
  return add(5);
}
console.log(outer());
