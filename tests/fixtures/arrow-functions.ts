const double = (x: number): number => x * 2;
const greet = (name: string): string => "Hello, " + name + "!";

console.log(double(5));
console.log(double(21));
console.log(greet("world"));

const add = (a: number, b: number): number => {
  return a + b;
};
console.log(add(3, 4));

const isEven = (n: number): boolean => n % 2 === 0;
console.log(isEven(4));
console.log(isEven(7));
