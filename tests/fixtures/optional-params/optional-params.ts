function greet(name: string, greeting: string = "Hello"): string {
  return greeting + ", " + name;
}

function add(a: number, b: number = 10): number {
  return a + b;
}

function multiply(x: number, y?: number): number {
  if (y) {
    return x * y;
  }
  return x * 2;
}

console.log(greet("World"));
console.log(greet("World", "Hi"));
console.log(add(5));
console.log(add(5, 3));
console.log(multiply(7));
console.log(multiply(7, 3));
