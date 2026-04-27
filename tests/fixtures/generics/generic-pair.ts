function first<A, B>(a: A, b: B): A {
  return a;
}

function second<A, B>(a: A, b: B): B {
  return b;
}

console.log(first<number, string>(10, "hi"));
console.log(second<number, string>(10, "hi"));
console.log(first<string, number>("bye", 20));
console.log(second<string, number>("bye", 20));
