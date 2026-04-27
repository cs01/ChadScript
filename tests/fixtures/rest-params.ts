function sum(first: number, ...rest: number[]): number {
  let total = first;
  for (let i = 0; i < rest.length; i++) {
    total = total + rest[i];
  }
  return total;
}

console.log(sum(1, 2, 3));
console.log(sum(10));
console.log(sum(1, 2, 3, 4, 5));

function join(sep: string, ...parts: string[]): string {
  let result = "";
  for (let i = 0; i < parts.length; i++) {
    if (i > 0) result = result + sep;
    result = result + parts[i];
  }
  return result;
}

console.log(join(", ", "a", "b", "c"));
