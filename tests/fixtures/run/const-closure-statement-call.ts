// @known-bug: a statement-position call through a const closure emits a call to an undefined symbol
const greet = (): void => {
  console.log("hi");
};
greet();
const add = (a: number, b: number): number => a + b;
add(1, 2);
console.log(add(2, 3));
