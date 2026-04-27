function identity<T>(x: T): T {
  return x;
}

const n: number = identity<number>(42);
const s: string = identity<string>("hello");
const b: boolean = identity<boolean>(true);

console.log(n);
console.log(s);
console.log(b);
