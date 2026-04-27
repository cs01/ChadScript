function wrap<T>(x: T): T {
  return x;
}

const a: number = wrap<number>(100);
const b: string = wrap<string>("world");
const c: number = wrap<number>(a + 1);

console.log(a);
console.log(b);
console.log(c);
