function run(cb: () => void, g: (x: number) => number): void {
  cb();
  g(3);
}
run(
  () => {
    console.log("a");
  },
  (x: number): number => {
    console.log(x);
    return x;
  },
);
const greet = (): void => {
  console.log("hi");
};
greet();
const add = (a: number, b: number): number => {
  console.log("add", a, b);
  return a + b;
};
add(1, 2);
let h = (s: string): string => {
  console.log(s);
  return s;
};
h("x");
h = (s: string): string => s + "!";
console.log(h("y"));
