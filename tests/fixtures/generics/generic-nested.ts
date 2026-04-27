function identity<T>(x: T): T {
  return x;
}

function double<T>(x: T): T {
  return identity<T>(x);
}

console.log(double<number>(21));
console.log(double<string>("hi"));
