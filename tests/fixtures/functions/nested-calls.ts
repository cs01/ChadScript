function square(x: number): number {
  return x * x;
}

function add(a: number, b: number): number {
  return a + b;
}

console.log(add(square(3), square(4)));
