function greet(name: string = "world"): string {
  return "hello " + name;
}
console.log(greet("chad"));
console.log(greet());

function add(a: number, b: number = 0): number {
  return a + b;
}
console.log(add(5, 3));
console.log(add(5));

function multi(x: number = 1, y: number = 2, z: number = 3): number {
  return x + y + z;
}
console.log(multi(10, 20, 30));
console.log(multi(10, 20));
console.log(multi(10));
console.log(multi());
