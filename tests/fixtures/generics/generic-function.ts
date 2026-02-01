function identity<T>(x: number): number {
  return x;
}

const result = identity<number>(42);
console.log(result);
